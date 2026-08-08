import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildAppWithContainer } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';
import type { FakeVoiceProvider } from '../../src/core/voice/FakeVoiceProvider';
import type { VoiceCallOutcome } from '../../src/core/voice/VoiceProvider';
import { prisma } from '../../src/core/prisma';
import { runWithRequestContext, type RequestContext } from '../../src/core/request-context';
import { voiceCallsQueue, voiceWebhookEventsQueue } from '../../src/core/queue/queues';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await voiceCallsQueue.obliterate({ force: true });
  await voiceWebhookEventsQueue.obliterate({ force: true });
});

async function setUpPendingAssignment(app: ReturnType<typeof buildAppWithContainer>['app']) {
  const owner = await registerOrganization(app);
  const shipResponse = await request(app)
    .post('/api/v1/ships')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({
      shipName: 'MSC Aurora',
      truckRequirements: [{ destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 2 }],
    });
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

  return { owner, assignmentId };
}

function systemContextFor(owner: { organizationId: string }): RequestContext {
  return {
    userId: 'test:system',
    organizationId: owner.organizationId,
    membershipId: 'test:system',
    role: 'OWNER',
  };
}

async function inviteViewer(
  app: ReturnType<typeof buildAppWithContainer>['app'],
  owner: { accessToken: string },
) {
  const invite = await request(app)
    .post('/api/v1/organizations/invitations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ email: 'viewer@example.com', role: 'VIEWER' });
  const accept = await request(app)
    .post('/api/v1/auth/accept-invitation')
    .send({
      token: invite.body.inviteToken,
      firstName: 'Vi',
      lastName: 'Ewer',
      password: 'correct-horse-battery-staple',
    });
  return accept.body.accessToken as string;
}

/** A second, genuinely different authorized user in the same org — used by
 * the ownership tests below, where "a different dispatcher" must mean a
 * different `userId`, not just a second request from the same owner. */
async function inviteDispatcher(
  app: ReturnType<typeof buildAppWithContainer>['app'],
  owner: { accessToken: string },
) {
  const invite = await request(app)
    .post('/api/v1/organizations/invitations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ email: 'second-dispatcher@example.com', role: 'DISPATCHER' });
  const accept = await request(app)
    .post('/api/v1/auth/accept-invitation')
    .send({
      token: invite.body.inviteToken,
      firstName: 'Dee',
      lastName: 'Ispatcher',
      password: 'correct-horse-battery-staple',
    });
  return {
    accessToken: accept.body.accessToken as string,
    userId: accept.body.user.id as string,
  };
}

/** Places a call and resolves it to the given outcome — a SYSTEM_ERROR/
 * ambiguous outcome escalates into the Yellow Zone as a side effect,
 * exactly as it would in production (voice.service.ts's real code path,
 * not a shortcut that bypasses it). */
async function placeAndResolve(
  container: ReturnType<typeof buildAppWithContainer>['container'],
  owner: { organizationId: string },
  assignmentId: string,
  outcome: VoiceCallOutcome,
) {
  await runWithRequestContext(systemContextFor(owner), () =>
    container.voiceService.executeCallPlacement({
      assignmentId,
      organizationId: owner.organizationId,
      callAttemptRef: `${assignmentId}:0`,
    }),
  );
  const placement = await prisma.voiceCallPlacement.findFirstOrThrow({ where: { assignmentId } });
  const fake = container.voiceProvider as FakeVoiceProvider;
  fake.setOutcome(placement.externalCallId, outcome);
  await container.voiceService.processWebhookSignal({
    provider: 'fake',
    eventId: `evt-${placement.externalCallId}`,
    externalCallId: placement.externalCallId,
  });
}

async function setUpEscalatedItem(
  app: ReturnType<typeof buildAppWithContainer>['app'],
  container: ReturnType<typeof buildAppWithContainer>['container'],
) {
  const { owner, assignmentId } = await setUpPendingAssignment(app);
  await placeAndResolve(container, owner, assignmentId, {
    kind: 'system_error',
    reason: 'CALL-E reported the call as failed.',
  });
  const list = await request(app)
    .get('/api/v1/yellow-zone')
    .set('Authorization', `Bearer ${owner.accessToken}`);
  return { owner, assignmentId, item: list.body.items[0] };
}

describe('yellow-zone module — escalation creation', () => {
  it('creates a Yellow Zone item with driver/ship context and a classified priority', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);

    expect(item).toMatchObject({
      driverName: 'Ahsan Raza',
      shipName: 'MSC Aurora',
      destination: 'Salalah, Oman',
      truckType: 'Flatbed',
      status: 'PENDING',
      priority: 'HIGH', // "reported the call as failed" classifies HIGH
      assignedToUserId: null,
      resolutionNotes: null,
    });
    expect(item.reason).toBe('CALL-E reported the call as failed.');

    // Also visible via the existing Calls history — the same
    // AssignmentAttempt row both features read from.
    const calls = await request(app)
      .get('/api/v1/voice-calls')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(calls.body.items[0].outcome).toBe('SYSTEM_ERROR');
  });

  it('never creates a duplicate escalation for a duplicate webhook delivery', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    await placeAndResolve(container, owner, assignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    const placement = await prisma.voiceCallPlacement.findFirstOrThrow({ where: { assignmentId } });
    // A second, distinct webhook event id for the same already-resolved
    // call — the exact "duplicate delivery" shape CALL-E can produce.
    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: `evt-duplicate-${placement.externalCallId}`,
      externalCallId: placement.externalCallId,
    });

    const list = await request(app)
      .get('/api/v1/yellow-zone')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(list.body.items).toHaveLength(1);
  });

  it('escalates a reconciliation-timeout SYSTEM_ERROR exactly like a webhook one', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);

    await runWithRequestContext(systemContextFor(owner), () =>
      container.voiceService.executeCallPlacement({
        assignmentId,
        organizationId: owner.organizationId,
        callAttemptRef: `${assignmentId}:0`,
      }),
    );
    const placement = await prisma.voiceCallPlacement.findFirstOrThrow({ where: { assignmentId } });
    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, { kind: 'pending' });

    await prisma.voiceCallPlacement.update({
      where: { id: placement.id },
      data: { placedAt: new Date(Date.now() - 60 * 60_000) },
    });

    await container.voiceService.reconcileStaleAttempts();

    const list = await request(app)
      .get('/api/v1/yellow-zone')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].priority).toBe('LOW'); // timeout reason classifies LOW
  });
});

describe('yellow-zone module — listing and stats', () => {
  it('lists items, most recent first, and filters by status/priority', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    await placeAndResolve(container, owner, assignmentId, {
      kind: 'ambiguous',
      reason: 'Driver response was classified as unclear.',
    });

    const all = await request(app)
      .get('/api/v1/yellow-zone')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(all.body.items).toHaveLength(1);
    expect(all.body.items[0].priority).toBe('MEDIUM');

    const wrongStatus = await request(app)
      .get('/api/v1/yellow-zone')
      .query({ status: 'RESOLVED' })
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(wrongStatus.body.items).toHaveLength(0);

    const rightPriority = await request(app)
      .get('/api/v1/yellow-zone')
      .query({ priority: 'MEDIUM' })
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(rightPriority.body.items).toHaveLength(1);
  });

  it('never leaks another organization\'s items', async () => {
    const { app, container } = buildAppWithContainer();
    const orgA = await setUpPendingAssignment(app);
    await placeAndResolve(container, orgA.owner, orgA.assignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    const orgB = await setUpPendingAssignment(app);
    await placeAndResolve(container, orgB.owner, orgB.assignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    const response = await request(app)
      .get('/api/v1/yellow-zone')
      .set('Authorization', `Bearer ${orgB.owner.accessToken}`);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].assignmentId).toBe(orgB.assignmentId);
  });

  it('rejects an unauthenticated request', async () => {
    const { app } = buildAppWithContainer();
    const response = await request(app).get('/api/v1/yellow-zone');
    expect(response.status).toBe(401);
  });

  it('reports status counts', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    await placeAndResolve(container, owner, assignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    const response = await request(app)
      .get('/api/v1/yellow-zone/stats')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(response.body).toMatchObject({ PENDING: 1, IN_REVIEW: 0, RESOLVED: 0, DISMISSED: 0 });
  });
});

describe('yellow-zone module — claim', () => {
  it('lets a dispatcher claim a pending item', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);

    const response = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('IN_REVIEW');
    expect(response.body.assignedToUserId).toBe(owner.userId);
  });

  it('under concurrent claim requests, exactly one succeeds and the other gets a clean conflict', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);

    const [first, second] = await Promise.all([
      request(app)
        .patch(`/api/v1/yellow-zone/${item.id}/claim`)
        .set('Authorization', `Bearer ${owner.accessToken}`),
      request(app)
        .patch(`/api/v1/yellow-zone/${item.id}/claim`)
        .set('Authorization', `Bearer ${owner.accessToken}`),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const stored = await request(app)
      .get(`/api/v1/yellow-zone/${item.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(stored.body.status).toBe('IN_REVIEW');
  });

  it('rejects claiming an already-claimed item', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);

    await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const second = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(second.status).toBe(409);
  });

  it('rejects a VIEWER from claiming, but still allows reading', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);
    const viewerToken = await inviteViewer(app, owner);

    const claim = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(claim.status).toBe(403);

    const read = await request(app)
      .get('/api/v1/yellow-zone')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(read.status).toBe(200);
  });
});

describe('yellow-zone module — shared ownership (Phase 5 hardening decision)', () => {
  it('a different authorized dispatcher can resolve an item claimed by someone else', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);
    const second = await inviteDispatcher(app, owner);

    const claim = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(claim.status).toBe(200);
    expect(claim.body.assignedToUserId).toBe(owner.userId);

    // Dispatcher B, not the claimant, finishes it — intentional per the
    // shared-team-ownership decision (see yellow-zone.service.ts's
    // comment above claimYellowZoneItem), matching the exact precedent
    // already set by assignments.service.ts's confirm/reject/cancel,
    // none of which gate on createdByUserId either.
    const resolve = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/resolve`)
      .set('Authorization', `Bearer ${second.accessToken}`)
      .send({ resolutionNotes: 'Picked this up from my teammate, confirmed manually.' });

    expect(resolve.status).toBe(200);
    expect(resolve.body.status).toBe('RESOLVED');
    // The record of WHO claimed it is preserved — shared ownership means
    // anyone can finish it, not that the claim record itself is erased.
    expect(resolve.body.assignedToUserId).toBe(owner.userId);
  });

  it('a different authorized dispatcher can dismiss an item claimed by someone else', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);
    const second = await inviteDispatcher(app, owner);

    await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const dismiss = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/dismiss`)
      .set('Authorization', `Bearer ${second.accessToken}`)
      .send({});

    expect(dismiss.status).toBe(200);
    expect(dismiss.body.status).toBe('DISMISSED');
  });
});

describe('yellow-zone module — unclaim', () => {
  it('lets the claimant release an item back to PENDING', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);
    await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const response = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/unclaim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('PENDING');
    expect(response.body.assignedToUserId).toBeNull();
  });

  it('lets a different dispatcher claim it again after it is released', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);
    const second = await inviteDispatcher(app, owner);

    await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/unclaim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const reclaim = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${second.accessToken}`);

    expect(reclaim.status).toBe(200);
    expect(reclaim.body.assignedToUserId).toBe(second.userId);
  });

  it('rejects unclaim from anyone other than the claimant', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);
    const second = await inviteDispatcher(app, owner);

    await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const response = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/unclaim`)
      .set('Authorization', `Bearer ${second.accessToken}`);

    expect(response.status).toBe(409);
    const stored = await request(app)
      .get(`/api/v1/yellow-zone/${item.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(stored.body.status).toBe('IN_REVIEW');
    expect(stored.body.assignedToUserId).toBe(owner.userId);
  });

  it('rejects unclaiming an item that was never claimed', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);

    const response = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/unclaim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(409);
  });
});

describe('yellow-zone module — assignment linkage', () => {
  it('reports the underlying assignment\'s current status, and reflects it changing after escalation', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId, item } = await setUpEscalatedItem(app, container);

    expect(item.assignmentStatus).toBe('PENDING');

    // Yellow Zone resolution deliberately does not touch Assignment (see
    // yellow-zone.service.ts's module comment) — this proves the
    // separation holds in both directions: a human resolving the
    // Assignment through the normal flow does not silently resolve the
    // Yellow Zone item, and the item's DTO surfaces the drift instead of
    // hiding it.
    await request(app)
      .patch(`/api/v1/assignments/${assignmentId}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const refetched = await request(app)
      .get(`/api/v1/yellow-zone/${item.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(refetched.body.status).toBe('PENDING'); // Yellow Zone item itself is untouched
    expect(refetched.body.assignmentStatus).toBe('CONFIRMED'); // but now visibly stale
  });
});

describe('yellow-zone module — resolve', () => {
  it('resolves a claimed item with resolution notes', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);
    await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const response = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/resolve`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ resolutionNotes: 'Called the driver directly, confirmed manually.' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('RESOLVED');
    expect(response.body.resolutionNotes).toBe('Called the driver directly, confirmed manually.');
    expect(response.body.resolvedAt).not.toBeNull();
  });

  it('rejects resolving an item that was never claimed', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);

    const response = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/resolve`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ resolutionNotes: 'Should not be allowed.' });

    expect(response.status).toBe(409);
  });

  it('rejects an empty resolution note', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);
    await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const response = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/resolve`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ resolutionNotes: '' });

    expect(response.status).toBe(400);
  });
});

describe('yellow-zone module — dismiss', () => {
  it('dismisses a still-pending item directly, without claiming first', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);

    const response = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/dismiss`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ resolutionNotes: 'False alarm, no action needed.' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('DISMISSED');
  });

  it('dismisses a claimed (IN_REVIEW) item', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);
    await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const response = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/dismiss`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('DISMISSED');
  });

  it('rejects dismissing an already-resolved item', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, item } = await setUpEscalatedItem(app, container);
    await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/resolve`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ resolutionNotes: 'Already handled.' });

    const response = await request(app)
      .patch(`/api/v1/yellow-zone/${item.id}/dismiss`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({});

    expect(response.status).toBe(409);
  });
});
