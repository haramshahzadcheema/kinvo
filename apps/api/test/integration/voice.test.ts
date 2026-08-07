import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildAppWithContainer } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';
import type { FakeVoiceProvider } from '../../src/core/voice/FakeVoiceProvider';
import { prisma } from '../../src/core/prisma';
import { runWithRequestContext, type RequestContext } from '../../src/core/request-context';
import { voiceCallsQueue, voiceWebhookEventsQueue } from '../../src/core/queue/queues';

beforeEach(async () => {
  await resetDatabase();
});

// The voice queues persist jobs in Redis, which resetDatabase (a Postgres
// TRUNCATE) never touches — without this, every test run leaves job
// residue behind. Nothing in this file runs a real Worker, so nothing
// naturally drains them via removeOnComplete/removeOnFail.
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

describe('voice module — placing calls', () => {
  it('places a call and records a VoiceCallPlacement', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);

    await runWithRequestContext(systemContextFor(owner), () =>
      container.voiceService.executeCallPlacement({
        assignmentId,
        organizationId: owner.organizationId,
        callAttemptRef: `${assignmentId}:0`,
      }),
    );

    const placements = await prisma.voiceCallPlacement.findMany({ where: { assignmentId } });
    expect(placements).toHaveLength(1);
    expect(placements[0]?.provider).toBe('fake');
    expect(placements[0]?.resolvedAt).toBeNull();
  });

  it('surfaces an in-flight call on the assignment DTO, and clears it once resolved', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);

    const before = await request(app)
      .get(`/api/v1/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(before.body.pendingVoiceCall).toBeNull();

    await runWithRequestContext(systemContextFor(owner), () =>
      container.voiceService.executeCallPlacement({
        assignmentId,
        organizationId: owner.organizationId,
        callAttemptRef: `${assignmentId}:0`,
      }),
    );

    const inFlight = await request(app)
      .get(`/api/v1/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(inFlight.body.pendingVoiceCall).toEqual({
      provider: 'fake',
      placedAt: expect.any(String),
    });

    const placement = await prisma.voiceCallPlacement.findFirstOrThrow({ where: { assignmentId } });
    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, { kind: 'unreachable' });
    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: 'evt-clear-pending',
      externalCallId: placement.externalCallId,
    });

    const after = await request(app)
      .get(`/api/v1/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(after.body.pendingVoiceCall).toBeNull();
    expect(after.body.attempts[0].provider).toBe('fake');
  });

  it('skips placing a call when the assignment is no longer pending', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);

    await request(app)
      .patch(`/api/v1/assignments/${assignmentId}/withdraw`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    await runWithRequestContext(systemContextFor(owner), () =>
      container.voiceService.executeCallPlacement({
        assignmentId,
        organizationId: owner.organizationId,
        callAttemptRef: `${assignmentId}:0`,
      }),
    );

    const placements = await prisma.voiceCallPlacement.findMany({ where: { assignmentId } });
    expect(placements).toHaveLength(0);
  });

  it('is safe to execute the same placement job twice (a simulated worker retry)', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const jobData = {
      assignmentId,
      organizationId: owner.organizationId,
      callAttemptRef: `${assignmentId}:0`,
    };

    await runWithRequestContext(systemContextFor(owner), () =>
      container.voiceService.executeCallPlacement(jobData),
    );
    await runWithRequestContext(systemContextFor(owner), () =>
      container.voiceService.executeCallPlacement(jobData),
    );

    const placements = await prisma.voiceCallPlacement.findMany({ where: { assignmentId } });
    expect(placements).toHaveLength(1);
  });

  it('derives the same idempotency ref for two concurrent enqueues of the same round, and a distinct one for a later round', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);

    await runWithRequestContext(systemContextFor(owner), () =>
      container.voiceService.placeCallForAssignment(assignmentId),
    );
    await runWithRequestContext(systemContextFor(owner), () =>
      container.voiceService.placeCallForAssignment(assignmentId),
    );

    // Both enqueues before any placement exists compute the same ref
    // (round 0) and therefore the same BullMQ job id — the second is a
    // silent no-op at the queue layer, exactly like CALL-E's own
    // idempotency key would collapse a duplicate real call.
    const jobsInQueue = await voiceCallsQueue.getJobCountByTypes('waiting', 'active', 'delayed');
    expect(jobsInQueue).toBeGreaterThanOrEqual(1);

    await runWithRequestContext(systemContextFor(owner), () =>
      container.voiceService.executeCallPlacement({
        assignmentId,
        organizationId: owner.organizationId,
        callAttemptRef: `${assignmentId}:0`,
      }),
    );

    // A later, legitimate retry (after round 0 already produced a
    // placement) must not collide with round 0's job id.
    await runWithRequestContext(systemContextFor(owner), () =>
      container.voiceService.placeCallForAssignment(assignmentId),
    );
    const job = await voiceCallsQueue.getJob(`place-call:${assignmentId}:1`);
    expect(job).toBeDefined();
  });

  it('rejects placing a call for an assignment that is not pending', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);

    await request(app)
      .patch(`/api/v1/assignments/${assignmentId}/withdraw`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    await expect(
      runWithRequestContext(systemContextFor(owner), () =>
        container.voiceService.placeCallForAssignment(assignmentId),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('voice module — HTTP surface', () => {
  it('lets a dispatcher trigger a call via POST /assignments/:id/voice-calls', async () => {
    const { app } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);

    const response = await request(app)
      .post(`/api/v1/assignments/${assignmentId}/voice-calls`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(202);
  });

  it('rejects a VIEWER from triggering a call', async () => {
    const { app } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);

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

    const response = await request(app)
      .post(`/api/v1/assignments/${assignmentId}/voice-calls`)
      .set('Authorization', `Bearer ${accept.body.accessToken}`);

    expect(response.status).toBe(403);
  });

  it('accepts a webhook delivery with no authentication at all', async () => {
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

    const response = await request(app)
      .post('/webhooks/call-e')
      .send({ eventId: 'evt-1', externalCallId: placement.externalCallId });

    expect(response.status).toBe(200);
    const job = await voiceWebhookEventsQueue.getJob('webhook-event:fake:evt-1');
    expect(job).toBeDefined();
  });

  it('acknowledges a malformed/unrecognized webhook body without enqueueing anything', async () => {
    const { app } = buildAppWithContainer();

    const response = await request(app).post('/webhooks/call-e').send({ garbage: true });

    expect(response.status).toBe(200);
  });
});

describe('voice module — resolving outcomes', () => {
  async function placeAndGetPlacement(
    container: ReturnType<typeof buildAppWithContainer>['container'],
    owner: { organizationId: string },
    assignmentId: string,
  ) {
    await runWithRequestContext(systemContextFor(owner), () =>
      container.voiceService.executeCallPlacement({
        assignmentId,
        organizationId: owner.organizationId,
        callAttemptRef: `${assignmentId}:0`,
      }),
    );
    return prisma.voiceCallPlacement.findFirstOrThrow({ where: { assignmentId } });
  }

  it('confirms the assignment when the driver confirms', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const placement = await placeAndGetPlacement(container, owner, assignmentId);
    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, { kind: 'confirmed' });

    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: 'evt-confirm',
      externalCallId: placement.externalCallId,
    });

    const assignment = await request(app)
      .get(`/api/v1/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(assignment.body.status).toBe('CONFIRMED');

    const attempt = await prisma.assignmentAttempt.findUnique({
      where: { externalCallId: placement.externalCallId },
    });
    expect(attempt?.outcome).toBe('CONFIRMED');
    expect(attempt?.provider).toBe('fake');
    expect(attempt?.recordedByUserId).toBeNull();

    const resolvedPlacement = await prisma.voiceCallPlacement.findUniqueOrThrow({
      where: { id: placement.id },
    });
    expect(resolvedPlacement.resolvedAt).not.toBeNull();

    const webhookEvent = await prisma.voiceWebhookEvent.findUnique({ where: { id: 'evt-confirm' } });
    expect(webhookEvent?.attemptId).toBe(attempt?.id);
  });

  it('rejects the assignment when the driver declines', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const placement = await placeAndGetPlacement(container, owner, assignmentId);
    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, { kind: 'declined' });

    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: 'evt-decline',
      externalCallId: placement.externalCallId,
    });

    const assignment = await request(app)
      .get(`/api/v1/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(assignment.body.status).toBe('REJECTED');
  });

  it('logs UNREACHABLE without transitioning the assignment', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const placement = await placeAndGetPlacement(container, owner, assignmentId);
    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, { kind: 'unreachable' });

    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: 'evt-unreachable',
      externalCallId: placement.externalCallId,
    });

    const assignment = await request(app)
      .get(`/api/v1/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(assignment.body.status).toBe('PENDING');
    expect(assignment.body.attempts).toHaveLength(1);
    expect(assignment.body.attempts[0].outcome).toBe('UNREACHABLE');
  });

  it('logs an ambiguous outcome as SYSTEM_ERROR with the reason preserved in notes', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const placement = await placeAndGetPlacement(container, owner, assignmentId);
    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, {
      kind: 'ambiguous',
      reason: 'Driver response was classified as unclear.',
    });

    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: 'evt-ambiguous',
      externalCallId: placement.externalCallId,
    });

    const attempt = await prisma.assignmentAttempt.findUnique({
      where: { externalCallId: placement.externalCallId },
    });
    expect(attempt?.outcome).toBe('SYSTEM_ERROR');
    expect(attempt?.notes).toBe('Driver response was classified as unclear.');
  });

  it('leaves a still-pending call untouched — no attempt, placement stays unresolved', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const placement = await placeAndGetPlacement(container, owner, assignmentId);
    // Outcome defaults to `pending` — no setOutcome call.

    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: 'evt-still-pending',
      externalCallId: placement.externalCallId,
    });

    const attempt = await prisma.assignmentAttempt.findUnique({
      where: { externalCallId: placement.externalCallId },
    });
    expect(attempt).toBeNull();
    const resolvedPlacement = await prisma.voiceCallPlacement.findUniqueOrThrow({
      where: { id: placement.id },
    });
    expect(resolvedPlacement.resolvedAt).toBeNull();
  });

  it('discards a webhook for an externalCallId Kinvo never placed', async () => {
    const { container } = buildAppWithContainer();

    await expect(
      container.voiceService.processWebhookSignal({
        provider: 'fake',
        eventId: 'evt-unknown',
        externalCallId: 'fake_call_never_placed',
      }),
    ).resolves.toBeUndefined();

    const webhookEvent = await prisma.voiceWebhookEvent.findUnique({ where: { id: 'evt-unknown' } });
    expect(webhookEvent).toBeNull();
  });

  it('is idempotent for a literal duplicate webhook delivery (same eventId)', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const placement = await placeAndGetPlacement(container, owner, assignmentId);
    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, { kind: 'confirmed' });

    const jobData = { provider: 'fake', eventId: 'evt-dup', externalCallId: placement.externalCallId };
    await container.voiceService.processWebhookSignal(jobData);
    await container.voiceService.processWebhookSignal(jobData);

    const attempts = await prisma.assignmentAttempt.findMany({ where: { assignmentId } });
    expect(attempts).toHaveLength(1);
  });

  it('is idempotent when two different terminal event ids resolve the same call', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const placement = await placeAndGetPlacement(container, owner, assignmentId);
    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, { kind: 'confirmed' });

    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: 'evt-first',
      externalCallId: placement.externalCallId,
    });
    // A second, distinct event for the very same call (e.g. a lagging
    // duplicate of a different type) must not double-apply the outcome —
    // by the time this runs the assignment is already CONFIRMED, so a naive
    // implementation would try to confirm it again and blow up.
    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: 'evt-second',
      externalCallId: placement.externalCallId,
    });

    const attempts = await prisma.assignmentAttempt.findMany({ where: { assignmentId } });
    expect(attempts).toHaveLength(1);
    const events = await prisma.voiceWebhookEvent.findMany({
      where: { attemptId: attempts[0]?.id },
    });
    expect(events.map((e) => e.id).sort()).toEqual(['evt-first', 'evt-second']);
  });

  it('is safe when two different terminal event ids for the same call are processed truly concurrently', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const placement = await placeAndGetPlacement(container, owner, assignmentId);
    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, { kind: 'confirmed' });

    // Two different worker concurrency slots racing on the exact same
    // externalCallId — neither has committed by the time the other starts,
    // so both pass resolvePlacement's existingAttempt check and reach
    // AssignmentAttempt.create() at roughly the same time. Must not throw
    // (a naive implementation lets the loser's unique-constraint violation
    // propagate uncaught).
    await expect(
      Promise.all([
        container.voiceService.processWebhookSignal({
          provider: 'fake',
          eventId: 'evt-concurrent-a',
          externalCallId: placement.externalCallId,
        }),
        container.voiceService.processWebhookSignal({
          provider: 'fake',
          eventId: 'evt-concurrent-b',
          externalCallId: placement.externalCallId,
        }),
      ]),
    ).resolves.toBeDefined();

    const attempts = await prisma.assignmentAttempt.findMany({ where: { assignmentId } });
    expect(attempts).toHaveLength(1);
    const assignment = await request(app)
      .get(`/api/v1/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(assignment.body.status).toBe('CONFIRMED');
  });

  it('still records the call outcome as history when the assignment was already resolved by a concurrent human action', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const placement = await placeAndGetPlacement(container, owner, assignmentId);
    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, { kind: 'confirmed' });

    // A human dispatcher rejects the assignment directly while the
    // automated call's webhook is in flight.
    await request(app)
      .patch(`/api/v1/assignments/${assignmentId}/reject`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({});

    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: 'evt-race',
      externalCallId: placement.externalCallId,
    });

    const assignment = await request(app)
      .get(`/api/v1/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    // The human action wins the assignment's own status...
    expect(assignment.body.status).toBe('REJECTED');
    // ...but the call's own outcome is still preserved as a logged attempt,
    // not silently dropped.
    const attempt = await prisma.assignmentAttempt.findUnique({
      where: { externalCallId: placement.externalCallId },
    });
    expect(attempt).not.toBeNull();
    expect(attempt?.notes).toMatch(/could no longer transition/);
  });
});

describe('voice module — reconciliation', () => {
  it('leaves a fresh, still-pending placement alone', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    await runWithRequestContext(systemContextFor(owner), () =>
      container.voiceService.executeCallPlacement({
        assignmentId,
        organizationId: owner.organizationId,
        callAttemptRef: `${assignmentId}:0`,
      }),
    );

    await container.voiceService.reconcileStaleAttempts();

    const attempt = await prisma.assignmentAttempt.findFirst({ where: { assignmentId } });
    expect(attempt).toBeNull();
  });

  it('force-times-out a placement stuck pending past the stale window', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const placement = await (async () => {
      await runWithRequestContext(systemContextFor(owner), () =>
        container.voiceService.executeCallPlacement({
          assignmentId,
          organizationId: owner.organizationId,
          callAttemptRef: `${assignmentId}:0`,
        }),
      );
      return prisma.voiceCallPlacement.findFirstOrThrow({ where: { assignmentId } });
    })();

    // Backdate placedAt past the configured stale window (30 minutes by
    // default — see .env.example) rather than waiting for real time to
    // pass.
    await prisma.voiceCallPlacement.update({
      where: { id: placement.id },
      data: { placedAt: new Date(Date.now() - 60 * 60_000) },
    });

    await container.voiceService.reconcileStaleAttempts();

    const attempt = await prisma.assignmentAttempt.findUnique({
      where: { externalCallId: placement.externalCallId },
    });
    expect(attempt?.outcome).toBe('SYSTEM_ERROR');
    expect(attempt?.notes).toMatch(/did not reach a terminal state/);

    const resolvedPlacement = await prisma.voiceCallPlacement.findUniqueOrThrow({
      where: { id: placement.id },
    });
    expect(resolvedPlacement.resolvedAt).not.toBeNull();
  });

  it('self-heals a stale placement whose call actually completed (a missed webhook)', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const placement = await (async () => {
      await runWithRequestContext(systemContextFor(owner), () =>
        container.voiceService.executeCallPlacement({
          assignmentId,
          organizationId: owner.organizationId,
          callAttemptRef: `${assignmentId}:0`,
        }),
      );
      return prisma.voiceCallPlacement.findFirstOrThrow({ where: { assignmentId } });
    })();

    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, { kind: 'confirmed' });
    await prisma.voiceCallPlacement.update({
      where: { id: placement.id },
      data: { placedAt: new Date(Date.now() - 60 * 60_000) },
    });

    await container.voiceService.reconcileStaleAttempts();

    const assignment = await request(app)
      .get(`/api/v1/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(assignment.body.status).toBe('CONFIRMED');
  });
});
