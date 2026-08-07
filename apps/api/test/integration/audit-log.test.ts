import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';
import { prisma } from '../../src/core/prisma';

beforeEach(async () => {
  await resetDatabase();
});

describe('audit log persistence', () => {
  it('persists a business action as a queryable AuditLogEntry row, not just a log line', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const ship = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipName: 'MSC Aurora' });
    expect(ship.status).toBe(201);

    // AuditLogEntry is deliberately not a TENANT_SCOPED_MODEL (no FK to
    // Organization to auto-scope through, and it must outlive the
    // organization it describes) — queried here via the raw model, the same
    // way a future reporting endpoint would.
    const entries = await prisma.auditLogEntry.findMany({ where: { type: 'ship.created' } });
    expect(entries).toHaveLength(1);
    expect(entries[0].actorUserId).toBe(owner.userId);
    expect(entries[0].organizationId).toBe(owner.organizationId);
    expect(entries[0].targetId).toBe(ship.body.id);
    expect(entries[0].metadata).toMatchObject({ shipName: 'MSC Aurora' });
  });

  it('records the audit entry for a shortage-triggered ship revert atomically with the ship write', async () => {
    // revertShipIfNowShort (assignments.service.ts) passes `tx` through to
    // auditLogger.record explicitly — this is the one call site where the
    // audit write must commit as part of the same transaction as the
    // ship-status change, not as an independent statement afterward.
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
    const driver = await request(app)
      .post('/api/v1/drivers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ fullName: 'Ahsan Raza', phone: '+92 300 1234567' });
    const assignment = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId, driverId: driver.body.id });
    await request(app)
      .patch(`/api/v1/assignments/${assignment.body.id}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    await request(app)
      .patch(`/api/v1/ships/${ship.body.id}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'RECRUITING' });
    await request(app)
      .patch(`/api/v1/ships/${ship.body.id}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'CONFIRMED' });

    await request(app)
      .patch(`/api/v1/assignments/${assignment.body.id}/cancel`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ reason: 'Truck broke down' });

    // The dispatcher's own two explicit status transitions (RECRUITING,
    // then CONFIRMED) also emit 'ship.status_changed' entries for this same
    // ship — the shortage-triggered revert is the third and most recent one.
    const statusEntries = await prisma.auditLogEntry.findMany({
      where: { type: 'ship.status_changed', targetId: ship.body.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(statusEntries).toHaveLength(3);
    const revertEntry = statusEntries[2];
    expect(revertEntry.metadata).toMatchObject({
      previousStatus: 'CONFIRMED',
      newStatus: 'RECRUITING',
      reason: 'shortage_after_assignment_change',
    });
  });

  it('keeps two organizations audit trails correctly attributed by organizationId', async () => {
    const app = buildApp();
    const ownerA = await registerOrganization(app);
    const ownerB = await registerOrganization(app);

    await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ shipName: 'Org A Ship' });
    await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ shipName: 'Org B Ship' });

    const orgAEntries = await prisma.auditLogEntry.findMany({
      where: { type: 'ship.created', organizationId: ownerA.organizationId },
    });
    const orgBEntries = await prisma.auditLogEntry.findMany({
      where: { type: 'ship.created', organizationId: ownerB.organizationId },
    });
    expect(orgAEntries).toHaveLength(1);
    expect(orgBEntries).toHaveLength(1);
    expect(orgAEntries[0].metadata).toMatchObject({ shipName: 'Org A Ship' });
    expect(orgBEntries[0].metadata).toMatchObject({ shipName: 'Org B Ship' });
  });
});
