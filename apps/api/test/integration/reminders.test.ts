import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildAppWithContainer } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';

beforeEach(async () => {
  await resetDatabase();
});

async function inviteViewer(
  app: ReturnType<typeof buildAppWithContainer>['app'],
  owner: { accessToken: string },
) {
  const invite = await request(app)
    .post('/api/v1/organizations/invitations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ email: 'viewer@example.com', role: 'VIEWER' });
  const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
    token: invite.body.inviteToken,
    firstName: 'Vi',
    lastName: 'Ewer',
    password: 'correct-horse-battery-staple',
  });
  return accept.body.accessToken as string;
}

async function inviteDispatcher(
  app: ReturnType<typeof buildAppWithContainer>['app'],
  owner: { accessToken: string },
) {
  const invite = await request(app)
    .post('/api/v1/organizations/invitations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ email: 'second-dispatcher@example.com', role: 'DISPATCHER' });
  const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
    token: invite.body.inviteToken,
    firstName: 'Dee',
    lastName: 'Ispatcher',
    password: 'correct-horse-battery-staple',
  });
  return { accessToken: accept.body.accessToken as string, userId: accept.body.user.id as string };
}

/** Creates a ship with one confirmed driver on it, matching what
 * currentConfirmedDriverCount/confirmedDriverCountAtApproval actually
 * measure (Driver.currentShipId + Driver.availability === 'CONFIRMED'),
 * not a fabricated number. */
async function setUpShipWithConfirmedDriver(
  app: ReturnType<typeof buildAppWithContainer>['app'],
  owner: { accessToken: string },
) {
  const shipResponse = await request(app)
    .post('/api/v1/ships')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({
      shipName: 'MSC Aurora',
      gate: 'Gate 3',
      reportingTime: new Date(Date.now() + 3_600_000).toISOString(),
      truckRequirements: [
        { destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 2 },
      ],
    });
  const shipId = shipResponse.body.id as string;
  const truckRequirementId = shipResponse.body.truckRequirements[0].id as string;

  const driverResponse = await request(app)
    .post('/api/v1/drivers')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ fullName: 'Ahsan Raza', phone: '+92 300 1234567', truckType: 'Flatbed' });
  const driverId = driverResponse.body.id as string;

  const assignmentResponse = await request(app)
    .post('/api/v1/assignments')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ truckRequirementId, driverId });
  const assignmentId = assignmentResponse.body.id as string;

  await request(app)
    .patch(`/api/v1/assignments/${assignmentId}/confirm`)
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .expect(200);

  return { shipId, driverId };
}

describe('reminder campaigns module — creation and listing', () => {
  it('creates a campaign for a ship and lists it back with a live confirmed-driver count', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, owner);

    const created = await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipId, notes: 'Report 30 minutes early.' })
      .expect(201);

    expect(created.body.status).toBe('PENDING_APPROVAL');
    expect(created.body.shipName).toBe('MSC Aurora');
    expect(created.body.shipGate).toBe('Gate 3');
    expect(created.body.currentConfirmedDriverCount).toBe(1);
    expect(created.body.confirmedDriverCountAtApproval).toBeNull();
    expect(created.body.approvedByUserId).toBeNull();
    expect(created.body.createdByUserName).toBe('Ada Lovelace');

    const list = await request(app)
      .get('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).toBe(created.body.id);
  });

  it('rejects a shipId that does not belong to this organization', async () => {
    const { app } = buildAppWithContainer();
    const ownerA = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, ownerA);
    const ownerB = await registerOrganization(app);

    await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ shipId })
      .expect(404);
  });

  it('rejects a missing shipId with 400, never a 500', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);

    await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({})
      .expect(400);
  });

  it('refuses a second pending campaign for a ship that already has one', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, owner);

    await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipId })
      .expect(201);

    const second = await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipId })
      .expect(400);
    expect(second.body.error.message).toMatch(/already has a reminder campaign/i);
  });

  it('under concurrent creation for the same ship, exactly one campaign is created and no request 500s', async () => {
    // Regression test for a real check-then-create race: the up-front
    // findFirst-then-create in createReminderCampaign lets multiple
    // concurrent requests all read "no pending campaign yet" before any of
    // them commits — without a database-level guarantee, this used to be
    // able to create more than one live PENDING_APPROVAL campaign for the
    // same ship. Closed by the reminder_campaigns_pending_unique migration's
    // partial unique index (shipId WHERE status = 'PENDING_APPROVAL'); this
    // test proves concurrent requests can no longer all win it, and that
    // the loser gets a clean 409, not a raw 500 from an uncaught
    // constraint violation.
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, owner);

    const CONCURRENCY = 10;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        request(app)
          .post('/api/v1/reminder-campaigns')
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({ shipId }),
      ),
    );

    const successes = responses.filter((r) => r.status === 201);
    const serverErrors = responses.filter((r) => r.status >= 500);
    expect(successes).toHaveLength(1);
    expect(serverErrors).toHaveLength(0);
    expect(
      responses.filter((r) => r.status !== 201).every((r) => r.status === 400 || r.status === 409),
    ).toBe(true);

    const pendingCount = await request(app)
      .get('/api/v1/reminder-campaigns?status=PENDING_APPROVAL')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(pendingCount.body.total).toBe(1);
  });

  it('filters the list by status', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, owner);
    const created = await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipId })
      .expect(201);

    await request(app)
      .patch(`/api/v1/reminder-campaigns/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const pending = await request(app)
      .get('/api/v1/reminder-campaigns?status=PENDING_APPROVAL')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(pending.body.items).toHaveLength(0);

    const sent = await request(app)
      .get('/api/v1/reminder-campaigns?status=SENT')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(sent.body.items).toHaveLength(1);
  });
});

describe('reminder campaigns module — approval workflow', () => {
  it('approves a pending campaign, snapshotting the confirmed-driver count at that moment', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, owner);
    const created = await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipId })
      .expect(201);

    const approved = await request(app)
      .patch(`/api/v1/reminder-campaigns/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(approved.body.status).toBe('SENT');
    expect(approved.body.confirmedDriverCountAtApproval).toBe(1);
    expect(approved.body.approvedByUserName).toBe('Ada Lovelace');
    expect(approved.body.approvedAt).not.toBeNull();
  });

  it('a different authorized teammate can approve a campaign they did not create — matches Yellow Zone claim/resolve, not a creator-only gate', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, owner);
    const second = await inviteDispatcher(app, owner);
    const created = await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipId })
      .expect(201);

    const approved = await request(app)
      .patch(`/api/v1/reminder-campaigns/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${second.accessToken}`)
      .expect(200);
    expect(approved.body.approvedByUserId).toBe(second.userId);
  });

  it('rejects approving an already-approved campaign with a clean 409', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, owner);
    const created = await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipId })
      .expect(201);

    await request(app)
      .patch(`/api/v1/reminder-campaigns/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    await request(app)
      .patch(`/api/v1/reminder-campaigns/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(409);
  });

  it('two concurrent approvals of the same campaign: exactly one succeeds, the other gets a clean 409', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, owner);
    const created = await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipId })
      .expect(201);

    const [first, second] = await Promise.all([
      request(app)
        .patch(`/api/v1/reminder-campaigns/${created.body.id}/approve`)
        .set('Authorization', `Bearer ${owner.accessToken}`),
      request(app)
        .patch(`/api/v1/reminder-campaigns/${created.body.id}/approve`)
        .set('Authorization', `Bearer ${owner.accessToken}`),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('cancels a pending campaign', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, owner);
    const created = await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipId })
      .expect(201);

    const cancelled = await request(app)
      .patch(`/api/v1/reminder-campaigns/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
  });

  it('rejects cancelling an already-sent campaign', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, owner);
    const created = await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipId })
      .expect(201);
    await request(app)
      .patch(`/api/v1/reminder-campaigns/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    await request(app)
      .patch(`/api/v1/reminder-campaigns/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(409);
  });

  it('a new pending campaign can be created for a ship once its previous campaign was cancelled', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, owner);
    const first = await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipId })
      .expect(201);
    await request(app)
      .patch(`/api/v1/reminder-campaigns/${first.body.id}/cancel`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipId })
      .expect(201);
  });
});

describe('reminder campaigns module — tenant isolation and RBAC', () => {
  it('org A cannot see org B campaigns in the list', async () => {
    const { app } = buildAppWithContainer();
    const ownerA = await registerOrganization(app);
    const { shipId: shipA } = await setUpShipWithConfirmedDriver(app, ownerA);
    await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ shipId: shipA })
      .expect(201);

    const ownerB = await registerOrganization(app);
    const list = await request(app)
      .get('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(0);
  });

  it('org A cannot fetch or approve org B campaign by ID — 404, not 403 (invisible, not forbidden)', async () => {
    const { app } = buildAppWithContainer();
    const ownerA = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, ownerA);
    const created = await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ shipId })
      .expect(201);

    const ownerB = await registerOrganization(app);
    await request(app)
      .get(`/api/v1/reminder-campaigns/${created.body.id}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);
    await request(app)
      .patch(`/api/v1/reminder-campaigns/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);
  });

  it('a VIEWER can read campaigns but not create or approve one', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { shipId } = await setUpShipWithConfirmedDriver(app, owner);
    const viewerToken = await inviteViewer(app, owner);

    await request(app)
      .get('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    await request(app)
      .post('/api/v1/reminder-campaigns')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ shipId })
      .expect(403);
  });

  it('requires authentication', async () => {
    const { app } = buildAppWithContainer();
    await request(app).get('/api/v1/reminder-campaigns').expect(401);
  });
});
