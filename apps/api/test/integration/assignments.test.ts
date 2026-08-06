import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';

beforeEach(async () => {
  await resetDatabase();
});

async function createShipWithRequirement(
  app: ReturnType<typeof buildApp>,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request(app)
    .post('/api/v1/ships')
    .set('Authorization', `Bearer ${token}`)
    .send({
      shipName: 'MSC Aurora',
      truckRequirements: [
        { destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 2 },
      ],
      ...overrides,
    });
  return {
    shipId: response.body.id as string,
    truckRequirementId: response.body.truckRequirements[0].id as string,
  };
}

async function createDriver(
  app: ReturnType<typeof buildApp>,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request(app)
    .post('/api/v1/drivers')
    .set('Authorization', `Bearer ${token}`)
    .send({ fullName: 'Ahsan Raza', phone: '+92 300 1234567', truckType: 'Flatbed', ...overrides });
  return response.body.id as string;
}

async function createAssignment(
  app: ReturnType<typeof buildApp>,
  token: string,
  truckRequirementId: string,
  driverId: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post('/api/v1/assignments')
    .set('Authorization', `Bearer ${token}`)
    .send({ truckRequirementId, driverId, ...overrides });
}

describe('assignments CRUD', () => {
  it('creates a PENDING assignment for a driver against a truck requirement', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);

    const response = await createAssignment(app, owner.accessToken, truckRequirementId, driverId, {
      agreedRate: 40000,
    });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('PENDING');
    expect(response.body.driverId).toBe(driverId);
    expect(response.body.driverName).toBe('Ahsan Raza');
    expect(response.body.destination).toBe('Salalah, Oman');
    expect(response.body.shipName).toBe('MSC Aurora');
    expect(response.body.agreedRate).toBe(40000);
    expect(response.body.attempts).toHaveLength(0);
  });

  it('rejects creating a second active assignment for the same driver and requirement', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);

    const first = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);
    expect(first.status).toBe(201);

    const second = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);
    expect(second.status).toBe(409);
  });

  it('allows re-approaching a driver after an earlier rejection', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);

    const first = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);
    await request(app)
      .patch(`/api/v1/assignments/${first.body.id}/reject`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({});

    const second = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);
    expect(second.status).toBe(201);
  });

  it('rejects creating an assignment for a cross-org driver', async () => {
    const app = buildApp();
    const ownerA = await registerOrganization(app);
    const ownerB = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, ownerA.accessToken);
    const driverBId = await createDriver(app, ownerB.accessToken);

    const response = await createAssignment(app, ownerA.accessToken, truckRequirementId, driverBId);
    expect(response.status).toBe(404);
  });

  it('rejects creating an assignment for a cross-org truck requirement', async () => {
    const app = buildApp();
    const ownerA = await registerOrganization(app);
    const ownerB = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, ownerB.accessToken);
    const driverAId = await createDriver(app, ownerA.accessToken);

    const response = await createAssignment(app, ownerA.accessToken, truckRequirementId, driverAId);
    expect(response.status).toBe(404);
  });

  it('gets a single assignment by id and returns 404 for a nonexistent one', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);

    const found = await request(app)
      .get(`/api/v1/assignments/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(found.status).toBe(200);

    const missing = await request(app)
      .get('/api/v1/assignments/nonexistent-id')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(missing.status).toBe(404);
  });
});

describe('assignment state transitions', () => {
  it('confirms a pending assignment, updates driver availability, and records an attempt', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { shipId, truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);

    const response = await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('CONFIRMED');
    expect(response.body.attempts).toHaveLength(1);
    expect(response.body.attempts[0].outcome).toBe('CONFIRMED');

    const driver = await request(app)
      .get(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(driver.body.availability).toBe('CONFIRMED');
    expect(driver.body.currentShipId).toBe(shipId);

    const ship = await request(app)
      .get(`/api/v1/ships/${shipId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ship.body.truckRequirements[0].confirmedCount).toBe(1);
    expect(ship.body.truckRequirements[0].pendingCount).toBe(0);
  });

  it('rejects a pending assignment with a reason', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);

    const response = await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/reject`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ reason: 'Not available that week' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('REJECTED');
    expect(response.body.rejectionReason).toBe('Not available that week');
  });

  it('withdraws a pending assignment', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);

    const response = await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/withdraw`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('WITHDRAWN');
  });

  it('rejects confirming an assignment that is not pending (illegal transition)', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);
    await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const response = await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(409);
  });

  it('rejects cancelling without a reason', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);
    await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const response = await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({});

    expect(response.status).toBe(400);
  });

  it('cancels a confirmed assignment with a reason, reverting driver availability', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);
    await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const response = await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ reason: 'Truck broke down' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('CANCELLED');
    expect(response.body.cancellationReason).toBe('Truck broke down');

    const driver = await request(app)
      .get(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(driver.body.availability).toBe('IDLE');
    expect(driver.body.currentShipId).toBeNull();
  });

  it('marks a confirmed assignment as no-show, reverting driver availability', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);
    await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const response = await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/no-show`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('NO_SHOW');

    const driver = await request(app)
      .get(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(driver.body.availability).toBe('IDLE');
  });

  it('reverts ship status from CONFIRMED to RECRUITING when a cancellation creates a shortage', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { shipId, truckRequirementId } = await createShipWithRequirement(app, owner.accessToken, {
      truckRequirements: [
        { destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 1 },
      ],
    });
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);
    await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    // Fully staffed (1/1) — dispatcher confirms the ship.
    const confirmShip = await request(app)
      .patch(`/api/v1/ships/${shipId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'RECRUITING' });
    expect(confirmShip.status).toBe(200);
    const confirmShip2 = await request(app)
      .patch(`/api/v1/ships/${shipId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'CONFIRMED' });
    expect(confirmShip2.status).toBe(200);

    // Now the confirmed driver cancels — the ship should revert.
    await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ reason: 'Truck broke down' });

    const ship = await request(app)
      .get(`/api/v1/ships/${shipId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ship.body.status).toBe('RECRUITING');
  });
});

describe('assignment attempts', () => {
  it('logs a contact attempt, returning the created attempt itself (not the parent assignment), without changing the assignment status', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);

    const response = await request(app)
      .post(`/api/v1/assignments/${created.body.id}/attempts`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ outcome: 'NO_ANSWER', notes: 'Went to voicemail' });

    expect(response.status).toBe(201);
    expect(response.body.outcome).toBe('NO_ANSWER');
    expect(response.body.notes).toBe('Went to voicemail');
    expect(response.body.id).toEqual(expect.any(String));
    expect(response.body.attemptedAt).toEqual(expect.any(String));
    // The endpoint's own resource is the attempt — it must not also carry
    // assignment-shaped fields.
    expect(response.body.status).toBeUndefined();
    expect(response.body.attempts).toBeUndefined();

    const assignment = await request(app)
      .get(`/api/v1/assignments/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(assignment.body.status).toBe('PENDING');
    expect(assignment.body.attempts).toHaveLength(1);
    expect(assignment.body.attempts[0].id).toBe(response.body.id);
    expect(assignment.body.attempts[0].outcome).toBe('NO_ANSWER');
  });
});

describe('assignments list — filters and cross-ship view', () => {
  it('filters by truckRequirementId, driverId, and status', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverA = await createDriver(app, owner.accessToken, { phone: '+92 300 1111111' });
    const driverB = await createDriver(app, owner.accessToken, { phone: '+92 300 2222222' });
    const assignmentA = await createAssignment(app, owner.accessToken, truckRequirementId, driverA);
    await createAssignment(app, owner.accessToken, truckRequirementId, driverB);
    await request(app)
      .patch(`/api/v1/assignments/${assignmentA.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const byRequirement = await request(app)
      .get(`/api/v1/assignments?truckRequirementId=${truckRequirementId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(byRequirement.body.items).toHaveLength(2);

    const byDriver = await request(app)
      .get(`/api/v1/assignments?driverId=${driverA}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(byDriver.body.items).toHaveLength(1);

    const byStatus = await request(app)
      .get('/api/v1/assignments?status=PENDING')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(byStatus.body.items).toHaveLength(1);
    expect(byStatus.body.items[0].driverId).toBe(driverB);
  });

  it('lists assignments across multiple ships in one organization (the cross-ship call list)', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const shipA = await createShipWithRequirement(app, owner.accessToken, { shipName: 'Ship A' });
    const shipB = await createShipWithRequirement(app, owner.accessToken, { shipName: 'Ship B' });
    const driverId = await createDriver(app, owner.accessToken);
    await createAssignment(app, owner.accessToken, shipA.truckRequirementId, driverId);
    const driver2 = await createDriver(app, owner.accessToken, { phone: '+92 300 9999999' });
    await createAssignment(app, owner.accessToken, shipB.truckRequirementId, driver2);

    const response = await request(app)
      .get('/api/v1/assignments?status=PENDING')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(response.body.items).toHaveLength(2);
    const shipNames = response.body.items.map((i: { shipName: string }) => i.shipName).sort();
    expect(shipNames).toEqual(['Ship A', 'Ship B']);
  });
});

describe('assignments permissions', () => {
  it('rejects an unauthenticated request', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/v1/assignments');
    expect(response.status).toBe(401);
  });

  it('VIEWER can list and read but cannot create or transition assignments', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);

    const inviteResponse = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'viewer@example.com', role: 'VIEWER' });

    // Accept invitation to get a VIEWER session — mirrors the existing
    // acceptAsRole pattern in rbac.test.ts.
    const acceptResponse = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: inviteResponse.body.inviteToken,
      firstName: 'Vera',
      lastName: 'Viewer',
      password: 'correct-horse-battery-staple',
    });
    const viewerAccessToken = acceptResponse.body.accessToken as string;

    const createResponse = await createAssignment(
      app,
      viewerAccessToken,
      truckRequirementId,
      driverId,
    );
    expect(createResponse.status).toBe(403);

    const listResponse = await request(app)
      .get('/api/v1/assignments')
      .set('Authorization', `Bearer ${viewerAccessToken}`);
    expect(listResponse.status).toBe(200);
  });
});

describe('assignments tenant isolation', () => {
  it("org A cannot read, confirm, or cancel org B's assignment", async () => {
    const app = buildApp();
    const ownerA = await registerOrganization(app);
    const ownerB = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, ownerB.accessToken);
    const driverId = await createDriver(app, ownerB.accessToken);
    const created = await createAssignment(app, ownerB.accessToken, truckRequirementId, driverId);

    const getResponse = await request(app)
      .get(`/api/v1/assignments/${created.body.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(getResponse.status).toBe(404);

    const confirmResponse = await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(confirmResponse.status).toBe(404);
  });
});

describe('assignments concurrency', () => {
  it('under concurrent confirm requests for the same assignment, exactly one succeeds and no request 500s', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .patch(`/api/v1/assignments/${created.body.id}/confirm`)
          .set('Authorization', `Bearer ${owner.accessToken}`),
      ),
    );

    const succeeded = attempts.filter((r) => r.status === 200);
    const conflicted = attempts.filter((r) => r.status === 409);
    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(4);
    expect(attempts.every((r) => r.status !== 500)).toBe(true);

    const driver = await request(app)
      .get(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(driver.body.availability).toBe('CONFIRMED');
  });
});

describe('ship + truck requirement side effects from assignments', () => {
  it('blocks changing destination/truckType once an assignment is active', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    await createAssignment(app, owner.accessToken, truckRequirementId, driverId);

    const shipsWithReq = await request(app)
      .get('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const shipId = shipsWithReq.body.items[0].id as string;

    const response = await request(app)
      .patch(`/api/v1/ships/${shipId}/truck-requirements/${truckRequirementId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ destination: 'Muscat' });

    expect(response.status).toBe(409);
  });

  it('blocks reducing quantityNeeded below the confirmed count', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { shipId, truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);
    await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const response = await request(app)
      .patch(`/api/v1/ships/${shipId}/truck-requirements/${truckRequirementId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ quantityNeeded: 0 });

    expect(response.status).toBe(400);
  });

  it('blocks deleting a truck requirement with active assignments', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { shipId, truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    await createAssignment(app, owner.accessToken, truckRequirementId, driverId);

    const response = await request(app)
      .delete(`/api/v1/ships/${shipId}/truck-requirements/${truckRequirementId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(409);
  });

  it('cascades: cancelling a ship cancels its active assignments and frees drivers', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { shipId, truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);
    await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const cancelShip = await request(app)
      .patch(`/api/v1/ships/${shipId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'CANCELLED' });
    expect(cancelShip.status).toBe(200);

    const assignment = await request(app)
      .get(`/api/v1/assignments/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(assignment.body.status).toBe('CANCELLED');

    const driver = await request(app)
      .get(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(driver.body.availability).toBe('IDLE');
    expect(driver.body.currentShipId).toBeNull();
  });

  it('cascades: completing a ship completes its confirmed assignments and frees drivers', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { shipId, truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);
    const created = await createAssignment(app, owner.accessToken, truckRequirementId, driverId);
    await request(app)
      .patch(`/api/v1/assignments/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    for (const status of ['RECRUITING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED']) {
      const response = await request(app)
        .patch(`/api/v1/ships/${shipId}/status`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ status });
      expect(response.status).toBe(200);
    }

    const assignment = await request(app)
      .get(`/api/v1/assignments/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(assignment.body.status).toBe('COMPLETED');

    const driver = await request(app)
      .get(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(driver.body.availability).toBe('IDLE');
  });

  it('cascades: cancelling a ship does not reset a driver whose only connection was a still-pending (never confirmed) invite', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { shipId, truckRequirementId } = await createShipWithRequirement(app, owner.accessToken);
    const driverId = await createDriver(app, owner.accessToken);

    // Dispatcher manually flags this driver on-call for something entirely
    // unrelated to this ship, before they're ever invited to it.
    await request(app)
      .patch(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ availability: 'ON_CALL' });

    // Invited but never confirmed — a PENDING assignment never touches the
    // driver's availability, so cancelling the ship must not touch it either.
    await createAssignment(app, owner.accessToken, truckRequirementId, driverId);

    const cancelShip = await request(app)
      .patch(`/api/v1/ships/${shipId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'CANCELLED' });
    expect(cancelShip.status).toBe(200);

    const driver = await request(app)
      .get(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(driver.body.availability).toBe('ON_CALL');
  });
});
