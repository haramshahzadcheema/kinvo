import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';

beforeEach(async () => {
  await resetDatabase();
});

async function createDriver(
  app: ReturnType<typeof buildApp>,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post('/api/v1/drivers')
    .set('Authorization', `Bearer ${token}`)
    .send({ fullName: 'Rashid Al-Amin', phone: '+971 50 213 4487', ...overrides });
}

describe('drivers CRUD', () => {
  it('creates a driver with the full field set', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await createDriver(app, owner.accessToken, {
      licenseNumber: 'UAE-DL-88213',
      truckPlate: 'TRK-2291',
      truckType: 'Flatbed',
      capacity: '40T',
      languages: 'Arabic, English',
      preferredRoutes: 'Jebel Ali–Abu Dhabi',
      preferredCompanies: 'MSC, CMA CGM',
      rating: 4.8,
    });

    expect(response.status).toBe(201);
    expect(response.body.fullName).toBe('Rashid Al-Amin');
    expect(response.body.availability).toBe('IDLE');
    expect(response.body.rating).toBe(4.8);
    expect(response.body.currentShipId).toBeNull();
  });

  it('rejects a driver with no phone number', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .post('/api/v1/drivers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ fullName: 'No Phone' });

    expect(response.status).toBe(400);
  });

  it('rejects a duplicate phone number within the same organization', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    await createDriver(app, owner.accessToken);

    const response = await createDriver(app, owner.accessToken, { fullName: 'Devon Miles' });
    expect(response.status).toBe(409);
  });

  it('allows the SAME phone number across two DIFFERENT organizations', async () => {
    const app = buildApp();
    const ownerA = await registerOrganization(app);
    const ownerB = await registerOrganization(app);

    const responseA = await createDriver(app, ownerA.accessToken);
    const responseB = await createDriver(app, ownerB.accessToken);

    expect(responseA.status).toBe(201);
    expect(responseB.status).toBe(201);
  });

  it('gets, updates, and deletes a driver', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const created = await createDriver(app, owner.accessToken);

    const getResponse = await request(app)
      .get(`/api/v1/drivers/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(getResponse.status).toBe(200);

    const updateResponse = await request(app)
      .patch(`/api/v1/drivers/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ availability: 'ON_CALL', notes: 'Prefers early morning routes' });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.availability).toBe('ON_CALL');
    expect(updateResponse.body.notes).toBe('Prefers early morning routes');

    const deleteResponse = await request(app)
      .delete(`/api/v1/drivers/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(deleteResponse.status).toBe(204);

    const getAfterDelete = await request(app)
      .get(`/api/v1/drivers/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(getAfterDelete.status).toBe(404);
  });

  it('returns 404 for a nonexistent driver id', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .get('/api/v1/drivers/nonexistent-id')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(response.status).toBe(404);
  });
});

describe('driver ship assignment (currentShipId)', () => {
  it('assigns a driver to a ship in the same organization and denormalizes the ship name', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const ship = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipName: 'MSC Aurora' });

    const response = await createDriver(app, owner.accessToken, {
      currentShipId: ship.body.id,
    });

    expect(response.status).toBe(201);
    expect(response.body.currentShipId).toBe(ship.body.id);
    expect(response.body.currentShipName).toBe('MSC Aurora');
  });

  it("rejects assigning a driver to another organization's ship", async () => {
    const app = buildApp();
    const ownerA = await registerOrganization(app);
    const ownerB = await registerOrganization(app);
    const shipB = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ shipName: "Org B's Ship" });

    const response = await createDriver(app, ownerA.accessToken, {
      currentShipId: shipB.body.id,
    });

    expect(response.status).toBe(400);
  });

  it('clears currentShipId when its ship is deleted (onDelete: SetNull)', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const ship = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipName: 'MSC Aurora' });
    const driver = await createDriver(app, owner.accessToken, { currentShipId: ship.body.id });

    await request(app)
      .delete(`/api/v1/ships/${ship.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const driverAfter = await request(app)
      .get(`/api/v1/drivers/${driver.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(driverAfter.body.currentShipId).toBeNull();
    expect(driverAfter.body.currentShipName).toBeNull();
  });
});

describe('drivers availability — cannot drift from a live confirmed assignment', () => {
  async function createConfirmedAssignment(app: ReturnType<typeof buildApp>, token: string) {
    const ship = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${token}`)
      .send({
        shipName: 'MSC Aurora',
        truckRequirements: [
          { destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 2 },
        ],
      });
    const truckRequirementId = ship.body.truckRequirements[0].id as string;
    const driver = await createDriver(app, token);
    const assignment = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${token}`)
      .send({ truckRequirementId, driverId: driver.body.id });
    await request(app)
      .patch(`/api/v1/assignments/${assignment.body.id}/confirm`)
      .set('Authorization', `Bearer ${token}`);

    return { driverId: driver.body.id as string, shipId: ship.body.id as string };
  }

  it('rejects marking a confirmed driver IDLE directly — this is the double-booking exploit path', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { driverId } = await createConfirmedAssignment(app, owner.accessToken);

    const response = await request(app)
      .patch(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ availability: 'IDLE' });

    expect(response.status).toBe(409);

    const driverAfter = await request(app)
      .get(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(driverAfter.body.availability).toBe('CONFIRMED');
  });

  it('rejects reassigning a confirmed driver to a different ship directly', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { driverId } = await createConfirmedAssignment(app, owner.accessToken);
    const otherShip = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipName: 'Sea Falcon' });

    const response = await request(app)
      .patch(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ currentShipId: otherShip.body.id });

    expect(response.status).toBe(409);
  });

  it('allows updating unrelated fields (e.g. notes) on a confirmed driver without touching availability', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { driverId } = await createConfirmedAssignment(app, owner.accessToken);

    const response = await request(app)
      .patch(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ notes: 'Requested an early start tomorrow' });

    expect(response.status).toBe(200);
    expect(response.body.availability).toBe('CONFIRMED');
    expect(response.body.notes).toBe('Requested an early start tomorrow');
  });

  it('allows re-sending the same availability/ship the driver is already confirmed on (no-op)', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { driverId, shipId } = await createConfirmedAssignment(app, owner.accessToken);

    const response = await request(app)
      .patch(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ availability: 'CONFIRMED', currentShipId: shipId });

    expect(response.status).toBe(200);
  });

  it('still allows freely changing availability on a driver with no active confirmed assignment', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const driver = await createDriver(app, owner.accessToken);

    const response = await request(app)
      .patch(`/api/v1/drivers/${driver.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ availability: 'ESCALATED' });

    expect(response.status).toBe(200);
    expect(response.body.availability).toBe('ESCALATED');
  });

  it('allows freely changing availability once the confirmed assignment is properly cancelled', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const ship = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        shipName: 'MSC Aurora',
        truckRequirements: [
          { destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 2 },
        ],
      });
    const truckRequirementId = ship.body.truckRequirements[0].id as string;
    const driver = await createDriver(app, owner.accessToken);
    const assignment = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId, driverId: driver.body.id });
    await request(app)
      .patch(`/api/v1/assignments/${assignment.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    await request(app)
      .patch(`/api/v1/assignments/${assignment.body.id}/cancel`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ reason: 'Driver had a family emergency' });

    const response = await request(app)
      .patch(`/api/v1/drivers/${driver.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ availability: 'ON_CALL' });

    expect(response.status).toBe(200);
    expect(response.body.availability).toBe('ON_CALL');
  });

  // Audit P0: Driver.availability could be forced to CONFIRMED with no
  // real backing Assignment via an ordinary PATCH — a driver that LOOKS
  // committed to a job but isn't actually on one. The tests above already
  // cover the mirror case (an already-CONFIRMED driver can't drift away);
  // these cover the direction the audit specifically flagged: entering
  // CONFIRMED without ever going through confirmAssignment.
  it('rejects PATCHing a driver with no assignment at all straight into CONFIRMED', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const driver = await createDriver(app, owner.accessToken);

    const response = await request(app)
      .patch(`/api/v1/drivers/${driver.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ availability: 'CONFIRMED' });

    expect(response.status).toBe(409);

    const driverAfter = await request(app)
      .get(`/api/v1/drivers/${driver.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(driverAfter.body.availability).toBe('IDLE');
  });

  it('rejects PATCHing a driver whose only assignment is merely PENDING (not yet confirmed) into CONFIRMED', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const ship = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        shipName: 'MSC Aurora',
        truckRequirements: [
          { destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 2 },
        ],
      });
    const truckRequirementId = ship.body.truckRequirements[0].id as string;
    const driver = await createDriver(app, owner.accessToken);
    await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId, driverId: driver.body.id });

    const response = await request(app)
      .patch(`/api/v1/drivers/${driver.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ availability: 'CONFIRMED' });

    expect(response.status).toBe(409);
  });

  it('rejects PATCHing a driver whose assignment was REJECTED (a terminal, non-confirmed outcome) into CONFIRMED', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const ship = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        shipName: 'MSC Aurora',
        truckRequirements: [
          { destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 2 },
        ],
      });
    const truckRequirementId = ship.body.truckRequirements[0].id as string;
    const driver = await createDriver(app, owner.accessToken);
    const assignment = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId, driverId: driver.body.id });
    await request(app)
      .patch(`/api/v1/assignments/${assignment.body.id}/reject`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ reason: 'Truck is in for maintenance' });

    const response = await request(app)
      .patch(`/api/v1/drivers/${driver.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ availability: 'CONFIRMED' });

    expect(response.status).toBe(409);
  });

  it('rejects CREATING a driver directly with availability CONFIRMED — a brand-new driver can never have a real assignment yet', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await createDriver(app, owner.accessToken, { availability: 'CONFIRMED' });

    expect(response.status).toBe(409);
  });

  it('a real confirmed assignment still legitimately produces CONFIRMED availability end-to-end', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const { driverId, shipId } = await createConfirmedAssignment(app, owner.accessToken);

    const driver = await request(app)
      .get(`/api/v1/drivers/${driverId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(driver.body.availability).toBe('CONFIRMED');
    expect(driver.body.currentShipId).toBe(shipId);
  });

  it("does not leak org B's assignment state into org A's attempt to force-confirm its own driver (tenant isolation)", async () => {
    const app = buildApp();
    const ownerA = await registerOrganization(app);
    const ownerB = await registerOrganization(app);
    // Org B has a real confirmed assignment for ITS driver — proves org A
    // can't somehow ride on org B's state, only its own is ever consulted.
    await createConfirmedAssignment(app, ownerB.accessToken);
    const driverA = await createDriver(app, ownerA.accessToken);

    const response = await request(app)
      .patch(`/api/v1/drivers/${driverA.body.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ availability: 'CONFIRMED' });

    expect(response.status).toBe(409);
  });
});

describe('driver deletion — blocked by assignment history', () => {
  async function createShipWithRequirement(app: ReturnType<typeof buildApp>, token: string) {
    const response = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${token}`)
      .send({
        shipName: 'MSC Aurora',
        truckRequirements: [
          { destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 2 },
        ],
      });
    return response.body.truckRequirements[0].id as string;
  }

  it('rejects deleting a driver with an active (PENDING) assignment, with a clean 409', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const truckRequirementId = await createShipWithRequirement(app, owner.accessToken);
    const driver = await createDriver(app, owner.accessToken);
    await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId, driverId: driver.body.id });

    const response = await request(app)
      .delete(`/api/v1/drivers/${driver.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(409);

    const driverAfter = await request(app)
      .get(`/api/v1/drivers/${driver.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(driverAfter.status).toBe(200);
  });

  it('rejects deleting a driver whose only assignment is already terminal — the FK still blocks it, and this must surface as a clean 409, not the raw 500 it used to', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const truckRequirementId = await createShipWithRequirement(app, owner.accessToken);
    const driver = await createDriver(app, owner.accessToken);
    const assignment = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId, driverId: driver.body.id });
    await request(app)
      .patch(`/api/v1/assignments/${assignment.body.id}/withdraw`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    // The proactive active-count check passes (WITHDRAWN isn't active) —
    // this specifically exercises the P2003 fallback, since the assignment
    // row itself still exists (it's never deleted, only its status
    // changes) and the FK still blocks the driver's deletion regardless.
    const response = await request(app)
      .delete(`/api/v1/drivers/${driver.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(409);
  });
});

describe('drivers list — search, filter, sort, pagination', () => {
  it('filters by availability and searches by name/plate/phone', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    await createDriver(app, owner.accessToken, {
      fullName: 'Priya Nair',
      phone: '+971 55 902 7761',
      truckPlate: 'TRK-3350',
      availability: 'ESCALATED',
    });
    await createDriver(app, owner.accessToken, {
      fullName: 'Tomas Reyes',
      phone: '+1 281 555 0199',
      truckPlate: 'TRK-0873',
      // ON_CALL, not CONFIRMED — CONFIRMED can no longer be set without a
      // real backing assignment (see the driver-availability-invariant
      // fix below); this test only needs a second, distinct availability
      // value to prove the filter itself works.
      availability: 'ON_CALL',
    });

    const searchResponse = await request(app)
      .get('/api/v1/drivers?search=Priya')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(searchResponse.body.items).toHaveLength(1);
    expect(searchResponse.body.items[0].fullName).toBe('Priya Nair');

    const plateResponse = await request(app)
      .get('/api/v1/drivers?search=TRK-0873')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(plateResponse.body.items).toHaveLength(1);
    expect(plateResponse.body.items[0].fullName).toBe('Tomas Reyes');

    const availabilityResponse = await request(app)
      .get('/api/v1/drivers?availability=ESCALATED')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(availabilityResponse.body.items).toHaveLength(1);
    expect(availabilityResponse.body.items[0].availability).toBe('ESCALATED');
  });

  it('paginates and sorts by fullName', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    let i = 0;
    for (const name of ['Zara', 'Amir', 'Mona']) {
      i += 1;
      await createDriver(app, owner.accessToken, {
        fullName: name,
        phone: `+971 5${i} 000 000${i}`,
      });
    }

    const response = await request(app)
      .get('/api/v1/drivers?page=1&pageSize=2&sortBy=fullName&sortOrder=asc')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.body.items).toHaveLength(2);
    expect(response.body.total).toBe(3);
    expect(response.body.items.map((d: { fullName: string }) => d.fullName)).toEqual([
      'Amir',
      'Mona',
    ]);
  });
});

describe('drivers permissions', () => {
  it('rejects an unauthenticated request', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/v1/drivers');
    expect(response.status).toBe(401);
  });

  it('VIEWER can list and read drivers but cannot create, update, or delete', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const invite = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'viewer@example.com', role: 'VIEWER' });
    const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: invite.body.inviteToken,
      password: 'a-perfectly-good-password',
      firstName: 'View',
      lastName: 'Only',
    });
    const viewerToken = accept.body.accessToken as string;
    const created = await createDriver(app, owner.accessToken);

    const listResponse = await request(app)
      .get('/api/v1/drivers')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(listResponse.status).toBe(200);

    const createResponse = await createDriver(app, viewerToken, { phone: '+971 50 000 0000' });
    expect(createResponse.status).toBe(403);

    const updateResponse = await request(app)
      .patch(`/api/v1/drivers/${created.body.id}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ availability: 'ON_CALL' });
    expect(updateResponse.status).toBe(403);

    const deleteResponse = await request(app)
      .delete(`/api/v1/drivers/${created.body.id}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(deleteResponse.status).toBe(403);
  });
});

describe('drivers tenant isolation', () => {
  it("org A cannot read, update, or delete org B's driver", async () => {
    const app = buildApp();
    const ownerA = await registerOrganization(app);
    const ownerB = await registerOrganization(app);
    const driverB = await createDriver(app, ownerB.accessToken);

    const getResponse = await request(app)
      .get(`/api/v1/drivers/${driverB.body.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(getResponse.status).toBe(404);

    const updateResponse = await request(app)
      .patch(`/api/v1/drivers/${driverB.body.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ availability: 'ON_CALL' });
    expect(updateResponse.status).toBe(404);

    const deleteResponse = await request(app)
      .delete(`/api/v1/drivers/${driverB.body.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(deleteResponse.status).toBe(404);

    const listResponse = await request(app)
      .get('/api/v1/drivers')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(listResponse.body.items).toHaveLength(0);
  });
});

describe('drivers concurrency', () => {
  it('under concurrent creates with the same phone, exactly one succeeds and no request 500s', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const phone = '+971 50 999 0000';

    const CONCURRENCY = 8;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        createDriver(app, owner.accessToken, { fullName: `Racer ${i}`, phone }),
      ),
    );

    const successes = responses.filter((r) => r.status === 201);
    const serverErrors = responses.filter((r) => r.status >= 500);
    expect(successes).toHaveLength(1);
    expect(serverErrors).toHaveLength(0);
    expect(responses.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);
  });

  it('under a concurrent availability edit and assignment confirmation for the same driver, they never both win', async () => {
    // updateDriver's active-assignment guard and its write used to be two
    // separate, unlocked statements — a concurrent confirmAssignment could
    // commit in the gap between them, and this plain "mark ESCALATED" edit
    // would still land unconditionally afterward, silently overwriting a
    // driver that had just become genuinely CONFIRMED on a job (or vice
    // versa: confirmAssignment's own atomic guard would correctly reject,
    // but only by luck of timing, not because updateDriver held up its end
    // of the guarantee).
    const app = buildApp();
    const owner = await registerOrganization(app);
    const ship = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        shipName: 'MSC Aurora',
        truckRequirements: [
          { destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 1 },
        ],
      });
    const truckRequirementId = ship.body.truckRequirements[0].id as string;
    const driver = await createDriver(app, owner.accessToken);
    const assignment = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId, driverId: driver.body.id });

    const [confirmResponse, updateResponse] = await Promise.all([
      request(app)
        .patch(`/api/v1/assignments/${assignment.body.id}/confirm`)
        .set('Authorization', `Bearer ${owner.accessToken}`),
      request(app)
        .patch(`/api/v1/drivers/${driver.body.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ availability: 'ESCALATED' }),
    ]);

    expect(confirmResponse.status).not.toBe(500);
    expect(updateResponse.status).not.toBe(500);

    const driverAfter = await request(app)
      .get(`/api/v1/drivers/${driver.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    if (confirmResponse.status === 200) {
      // The confirm won — the conflicting availability edit must have been
      // rejected, never silently applied on top of a driver that's now
      // genuinely committed to a job.
      expect(updateResponse.status).toBe(409);
      expect(driverAfter.body.availability).toBe('CONFIRMED');
      expect(driverAfter.body.currentShipId).toBe(ship.body.id);
    } else {
      // The availability edit landed first and displaced the driver before
      // the confirm attempt reached it — the confirm must see a driver
      // that's no longer IDLE and fail cleanly, never silently confirm
      // over the edit.
      expect(confirmResponse.status).toBe(409);
      expect(updateResponse.status).toBe(200);
      expect(driverAfter.body.availability).toBe('ESCALATED');
    }
  });
});
