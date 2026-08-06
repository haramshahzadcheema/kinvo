import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/prisma';
import { buildApp } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';

beforeEach(async () => {
  await resetDatabase();
});

async function createShip(
  app: ReturnType<typeof buildApp>,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post('/api/v1/ships')
    .set('Authorization', `Bearer ${token}`)
    .send({ shipName: 'Ever Given', company: 'Evergreen', ...overrides });
}

describe('ships CRUD', () => {
  it('creates a ship with nested truck and document requirements', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await createShip(app, owner.accessToken, {
      shipName: 'MSC Aurora',
      company: 'MSC',
      berth: '4',
      gate: 'Gate 2',
      cargoType: 'Containers',
      truckRequirements: [
        {
          destination: 'Salalah, Oman',
          truckType: 'Flatbed',
          quantityNeeded: 3,
          rate: 45,
          rateCurrency: 'PKR',
          notes: 'High priority',
        },
        { destination: 'Al Ain', truckType: 'Container Chassis', quantityNeeded: 2 },
      ],
      documentRequirements: [{ documentType: 'Port Entry Pass', isRequired: true }],
    });

    expect(response.status).toBe(201);
    expect(response.body.shipName).toBe('MSC Aurora');
    expect(response.body.status).toBe('DRAFT');
    expect(response.body.rate).toBeUndefined();
    expect(response.body.truckRequirements).toHaveLength(2);
    expect(response.body.documentRequirements).toHaveLength(1);

    // Rate is priced per destination/truck type, not per ship — a ship has
    // no rate of its own (see the Decisions log). A requirement with no
    // rate set simply has no rate; there is no ship-level fallback.
    const salalah = response.body.truckRequirements.find(
      (r: { destination: string }) => r.destination === 'Salalah, Oman',
    );
    const alAin = response.body.truckRequirements.find(
      (r: { destination: string }) => r.destination === 'Al Ain',
    );
    expect(salalah.rate).toBe(45);
    expect(salalah.rateCurrency).toBe('PKR');
    expect(salalah.notes).toBe('High priority');
    expect(alAin.rate).toBeNull();
    expect(alAin.notes).toBeNull();
  });

  it('rejects a ship with no shipName before touching the database', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ company: 'MSC' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a truck requirement with a non-positive quantity', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await createShip(app, owner.accessToken, {
      truckRequirements: [{ destination: 'Salalah', truckType: 'Flatbed', quantityNeeded: 0 }],
    });

    expect(response.status).toBe(400);
  });

  it('gets a single ship by id', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const created = await createShip(app, owner.accessToken);

    const response = await request(app)
      .get(`/api/v1/ships/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(created.body.id);
  });

  it('returns 404 for a nonexistent ship id', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .get('/api/v1/ships/nonexistent-id')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(404);
  });

  it('updates ship fields without touching status', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const created = await createShip(app, owner.accessToken);

    const response = await request(app)
      .patch(`/api/v1/ships/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ berth: '7', cargoType: 'Bulk', notes: 'Customs hold pending' });

    expect(response.status).toBe(200);
    expect(response.body.berth).toBe('7');
    expect(response.body.cargoType).toBe('Bulk');
    expect(response.body.notes).toBe('Customs hold pending');
    expect(response.body.status).toBe('DRAFT');
  });

  it('deletes a ship and cascades its requirements', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const created = await createShip(app, owner.accessToken, {
      truckRequirements: [{ destination: 'Salalah', truckType: 'Flatbed', quantityNeeded: 3 }],
    });
    const truckRequirementId = created.body.truckRequirements[0].id as string;

    const deleteResponse = await request(app)
      .delete(`/api/v1/ships/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(deleteResponse.status).toBe(204);

    const shipRow = await prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM ships WHERE id = ${created.body.id}`;
    expect(Number(shipRow[0]?.count)).toBe(0);

    const requirementRow = await prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM truck_requirements WHERE id = ${truckRequirementId}`;
    expect(Number(requirementRow[0]?.count)).toBe(0);
  });
});

describe('ships status transitions', () => {
  it('walks the full DRAFT -> RECRUITING -> CONFIRMED -> IN_PROGRESS -> COMPLETED lifecycle', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const created = await createShip(app, owner.accessToken);
    const shipId = created.body.id as string;

    for (const status of ['RECRUITING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED']) {
      const response = await request(app)
        .patch(`/api/v1/ships/${shipId}/status`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ status });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe(status);
    }
  });

  it('rejects skipping a status (DRAFT straight to COMPLETED)', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const created = await createShip(app, owner.accessToken);

    const response = await request(app)
      .patch(`/api/v1/ships/${created.body.id}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'COMPLETED' });

    expect(response.status).toBe(409);
  });

  it('allows cancellation from RECRUITING but never from COMPLETED', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const created = await createShip(app, owner.accessToken);
    const shipId = created.body.id as string;

    await request(app)
      .patch(`/api/v1/ships/${shipId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'RECRUITING' });

    const cancelResponse = await request(app)
      .patch(`/api/v1/ships/${shipId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'CANCELLED' });
    expect(cancelResponse.status).toBe(200);

    const reopenResponse = await request(app)
      .patch(`/api/v1/ships/${shipId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'RECRUITING' });
    expect(reopenResponse.status).toBe(409);
  });
});

describe('ships list — search, filter, sort, pagination', () => {
  it('filters by status and searches by name/company', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    await createShip(app, owner.accessToken, { shipName: 'MSC Aurora', company: 'MSC' });
    const everFortune = await createShip(app, owner.accessToken, {
      shipName: 'Ever Fortune',
      company: 'Evergreen',
    });
    await request(app)
      .patch(`/api/v1/ships/${everFortune.body.id}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'RECRUITING' });

    const searchResponse = await request(app)
      .get('/api/v1/ships?search=Fortune')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(searchResponse.body.items).toHaveLength(1);
    expect(searchResponse.body.items[0].shipName).toBe('Ever Fortune');

    const statusResponse = await request(app)
      .get('/api/v1/ships?status=RECRUITING')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(statusResponse.body.items).toHaveLength(1);
    expect(statusResponse.body.items[0].status).toBe('RECRUITING');
  });

  it('searches by a truck requirement destination, not just ship name/company', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    await createShip(app, owner.accessToken, {
      shipName: 'MSC Aurora',
      company: 'MSC',
      truckRequirements: [
        { destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 3 },
      ],
    });
    await createShip(app, owner.accessToken, {
      shipName: 'Ever Fortune',
      company: 'Evergreen',
      truckRequirements: [{ destination: 'Muscat', truckType: 'Container', quantityNeeded: 2 }],
    });

    const response = await request(app)
      .get('/api/v1/ships?search=salalah')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].shipName).toBe('MSC Aurora');
  });

  it('paginates and sorts', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    for (const name of ['Alpha', 'Bravo', 'Charlie']) {
      await createShip(app, owner.accessToken, { shipName: name });
    }

    const response = await request(app)
      .get('/api/v1/ships?page=1&pageSize=2&sortBy=shipName&sortOrder=asc')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.total).toBe(3);
    expect(response.body.totalPages).toBe(2);
    expect(response.body.items.map((s: { shipName: string }) => s.shipName)).toEqual([
      'Alpha',
      'Bravo',
    ]);
  });
});

describe('ships permissions', () => {
  it('rejects an unauthenticated request', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/v1/ships');
    expect(response.status).toBe(401);
  });

  it('VIEWER can list and read ships but cannot create, update, or delete', async () => {
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
    const created = await createShip(app, owner.accessToken);

    const listResponse = await request(app)
      .get('/api/v1/ships')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(listResponse.status).toBe(200);

    const createResponse = await createShip(app, viewerToken);
    expect(createResponse.status).toBe(403);

    const updateResponse = await request(app)
      .patch(`/api/v1/ships/${created.body.id}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ berth: '9' });
    expect(updateResponse.status).toBe(403);

    const deleteResponse = await request(app)
      .delete(`/api/v1/ships/${created.body.id}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(deleteResponse.status).toBe(403);
  });

  it('DISPATCHER can fully manage ships', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const invite = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'dispatcher@example.com', role: 'DISPATCHER' });
    const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: invite.body.inviteToken,
      password: 'a-perfectly-good-password',
      firstName: 'Dee',
      lastName: 'Dispatcher',
    });

    const response = await createShip(app, accept.body.accessToken as string);
    expect(response.status).toBe(201);
  });
});

describe('ships tenant isolation', () => {
  it("org A cannot read, update, delete, or transition org B's ship", async () => {
    const app = buildApp();
    const ownerA = await registerOrganization(app);
    const ownerB = await registerOrganization(app);
    const shipB = await createShip(app, ownerB.accessToken, { shipName: "Org B's Ship" });

    const getResponse = await request(app)
      .get(`/api/v1/ships/${shipB.body.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(getResponse.status).toBe(404);

    const updateResponse = await request(app)
      .patch(`/api/v1/ships/${shipB.body.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ berth: '1' });
    expect(updateResponse.status).toBe(404);

    const statusResponse = await request(app)
      .patch(`/api/v1/ships/${shipB.body.id}/status`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ status: 'RECRUITING' });
    expect(statusResponse.status).toBe(404);

    const deleteResponse = await request(app)
      .delete(`/api/v1/ships/${shipB.body.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(deleteResponse.status).toBe(404);

    const listResponse = await request(app)
      .get('/api/v1/ships')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(listResponse.body.items).toHaveLength(0);
  });
});

describe('truck and document requirements', () => {
  it('adds, updates, and removes a truck requirement', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const ship = await createShip(app, owner.accessToken);

    const addResponse = await request(app)
      .post(`/api/v1/ships/${ship.body.id}/truck-requirements`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ destination: 'Salalah', truckType: 'Flatbed', quantityNeeded: 3, rate: 40 });
    expect(addResponse.status).toBe(201);
    expect(addResponse.body.rate).toBe(40);
    const requirementId = addResponse.body.id as string;

    const updateResponse = await request(app)
      .patch(`/api/v1/ships/${ship.body.id}/truck-requirements/${requirementId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ quantityNeeded: 5, rate: 50 });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.quantityNeeded).toBe(5);
    expect(updateResponse.body.rate).toBe(50);

    const removeResponse = await request(app)
      .delete(`/api/v1/ships/${ship.body.id}/truck-requirements/${requirementId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(removeResponse.status).toBe(204);

    const shipAfter = await request(app)
      .get(`/api/v1/ships/${ship.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(shipAfter.body.truckRequirements).toHaveLength(0);
  });

  it('adds, updates, and removes a document requirement', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const ship = await createShip(app, owner.accessToken);

    const addResponse = await request(app)
      .post(`/api/v1/ships/${ship.body.id}/document-requirements`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ documentType: 'CNIC', isRequired: true });
    expect(addResponse.status).toBe(201);
    const requirementId = addResponse.body.id as string;

    const updateResponse = await request(app)
      .patch(`/api/v1/ships/${ship.body.id}/document-requirements/${requirementId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ isRequired: false });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.isRequired).toBe(false);

    const removeResponse = await request(app)
      .delete(`/api/v1/ships/${ship.body.id}/document-requirements/${requirementId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(removeResponse.status).toBe(204);
  });

  it("rejects mutating another organization's truck requirement, even addressed via one's own ship id", async () => {
    const app = buildApp();
    const ownerA = await registerOrganization(app);
    const ownerB = await registerOrganization(app);
    const shipA = await createShip(app, ownerA.accessToken);
    const shipB = await createShip(app, ownerB.accessToken);
    const requirementB = await request(app)
      .post(`/api/v1/ships/${shipB.body.id}/truck-requirements`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ destination: 'Salalah', truckType: 'Flatbed', quantityNeeded: 3 });

    // Org A tries to patch org B's requirement, dishonestly addressed
    // through org A's own (real, owned) ship id in the URL.
    const response = await request(app)
      .patch(`/api/v1/ships/${shipA.body.id}/truck-requirements/${requirementB.body.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ quantityNeeded: 99 });
    expect(response.status).toBe(404);
  });
});
