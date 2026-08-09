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

async function inviteMember(
  app: ReturnType<typeof buildAppWithContainer>['app'],
  owner: { accessToken: string },
  role: 'ADMIN' | 'DISPATCHER' | 'VIEWER',
  email: string,
) {
  const invite = await request(app)
    .post('/api/v1/organizations/invitations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ email, role });
  const accept = await request(app)
    .post('/api/v1/auth/accept-invitation')
    .send({
      token: invite.body.inviteToken,
      firstName: 'Test',
      lastName: role,
      password: 'correct-horse-battery-staple',
    });
  return {
    accessToken: accept.body.accessToken as string,
    userId: accept.body.user.id as string,
  };
}

/** Places a call and resolves it to the given outcome, going through the
 * real voice.service.ts code path — a SYSTEM_ERROR outcome escalates into
 * Yellow Zone AND fans out notifications as a side effect, exactly as it
 * would in production, not a shortcut that bypasses either. */
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

async function escalate(
  app: ReturnType<typeof buildAppWithContainer>['app'],
  container: ReturnType<typeof buildAppWithContainer>['container'],
) {
  const { owner, assignmentId } = await setUpPendingAssignment(app);
  await placeAndResolve(container, owner, assignmentId, {
    kind: 'system_error',
    reason: 'CALL-E reported the call as failed.',
  });
  return { owner, assignmentId };
}

describe('notification module — recipient targeting', () => {
  it('notifies OWNER, ADMIN, and DISPATCHER on a Yellow Zone escalation, but not VIEWER', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const admin = await inviteMember(app, owner, 'ADMIN', 'admin@example.com');
    const dispatcher = await inviteMember(app, owner, 'DISPATCHER', 'dispatcher@example.com');
    const viewer = await inviteMember(app, owner, 'VIEWER', 'viewer@example.com');

    await placeAndResolve(container, owner, assignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    for (const [label, token] of [
      ['owner', owner.accessToken],
      ['admin', admin.accessToken],
      ['dispatcher', dispatcher.accessToken],
    ] as const) {
      const response = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${token}`);
      expect(response.body.items, `${label} should have 1 notification`).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({
        type: 'YELLOW_ZONE_ESCALATED',
        targetType: 'YELLOW_ZONE_ITEM',
        readAt: null,
      });
    }

    const viewerResponse = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${viewer.accessToken}`);
    expect(viewerResponse.body.items).toHaveLength(0);
  });

  it('reports the correct unread count', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner } = await escalate(app, container);

    const response = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(response.body).toEqual({ count: 1 });
  });

  // Settings feature: a recipient who has turned off
  // yellowZoneEscalationNotifications must be excluded from the fan-out —
  // never build a toggle that visually changes but does nothing. The
  // dispatcher who never touched Settings (no UserPreferences row exists
  // yet) is the control: still notified by default.
  it('excludes a recipient who has opted out of Yellow Zone escalation notifications', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const dispatcher = await inviteMember(app, owner, 'DISPATCHER', 'dispatcher3@example.com');

    await request(app)
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ yellowZoneEscalationNotifications: false });

    await placeAndResolve(container, owner, assignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    const ownerInbox = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ownerInbox.body.items).toHaveLength(0);

    const dispatcherInbox = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${dispatcher.accessToken}`);
    expect(dispatcherInbox.body.items).toHaveLength(1);
  });
});

describe('notification module — tenant isolation', () => {
  it('never leaks another organization\'s notifications', async () => {
    const { app, container } = buildAppWithContainer();
    await escalate(app, container);
    const { owner: ownerB } = await escalate(app, container);

    const response = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(response.body.items).toHaveLength(1);

    const countResponse = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(countResponse.body.count).toBe(1);
  });

  it('cannot mark another organization\'s notification read', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner: ownerA } = await escalate(app, container);
    const { owner: ownerB } = await escalate(app, container);

    const listA = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    const notificationAId = listA.body.items[0].id as string;

    const response = await request(app)
      .patch(`/api/v1/notifications/${notificationAId}/read`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    // Invisible, not forbidden — matches the exact convention every other
    // cross-tenant probe in this codebase already established.
    expect(response.status).toBe(404);

    const stillUnread = await request(app)
      .get(`/api/v1/notifications`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(stillUnread.body.items[0].readAt).toBeNull();
  });

  it('mark-all-read only affects the calling organization', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner: ownerA } = await escalate(app, container);
    const { owner: ownerB } = await escalate(app, container);

    await request(app)
      .patch('/api/v1/notifications/mark-all-read')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);

    const countB = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(countB.body.count).toBe(1);
  });
});

describe('notification module — user isolation within one organization', () => {
  it('one dispatcher cannot see or mark read another dispatcher\'s private notification', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const dispatcher = await inviteMember(app, owner, 'DISPATCHER', 'dispatcher2@example.com');

    await placeAndResolve(container, owner, assignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    // Both owner and dispatcher are recipients (both are yellow-zone:manage
    // holders) — each has their OWN row, not a shared one.
    const ownerList = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const dispatcherList = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${dispatcher.accessToken}`);
    expect(ownerList.body.items).toHaveLength(1);
    expect(dispatcherList.body.items).toHaveLength(1);
    const ownerNotificationId = ownerList.body.items[0].id as string;
    expect(ownerNotificationId).not.toBe(dispatcherList.body.items[0].id);

    // The dispatcher marking THEIR OWN notification read must never affect
    // the owner's separate row for the same underlying escalation.
    await request(app)
      .patch(`/api/v1/notifications/${dispatcherList.body.items[0].id}/read`)
      .set('Authorization', `Bearer ${dispatcher.accessToken}`);

    const ownerAfter = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ownerAfter.body.items[0].readAt).toBeNull();

    // And the dispatcher can never reach the owner's row by id, even
    // though it's the same organization.
    const crossUser = await request(app)
      .patch(`/api/v1/notifications/${ownerNotificationId}/read`)
      .set('Authorization', `Bearer ${dispatcher.accessToken}`);
    expect(crossUser.status).toBe(404);
  });
});

describe('notification module — RBAC (ownership-based, not role-based)', () => {
  it('every role can read and manage its own inbox, including VIEWER', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const viewer = await inviteMember(app, owner, 'VIEWER', 'viewer2@example.com');

    // VIEWER isn't a recipient of anything yet, but the endpoint itself
    // must not be role-gated — an empty inbox is a valid response, a 403
    // would not be.
    const emptyInbox = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${viewer.accessToken}`);
    expect(emptyInbox.status).toBe(200);
    expect(emptyInbox.body.items).toHaveLength(0);

    const markAll = await request(app)
      .patch('/api/v1/notifications/mark-all-read')
      .set('Authorization', `Bearer ${viewer.accessToken}`);
    expect(markAll.status).toBe(200);
    expect(markAll.body).toEqual({ count: 0 });

    await placeAndResolve(container, owner, assignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    const ownerInbox = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ownerInbox.status).toBe(200);
    expect(ownerInbox.body.items).toHaveLength(1);
  });

  it('rejects an unauthenticated request', async () => {
    const { app } = buildAppWithContainer();
    const response = await request(app).get('/api/v1/notifications');
    expect(response.status).toBe(401);
  });
});

describe('notification module — read state', () => {
  it('marks a notification read and is idempotent on a second call', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner } = await escalate(app, container);

    const list = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const id = list.body.items[0].id as string;

    const first = await request(app)
      .patch(`/api/v1/notifications/${id}/read`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(first.status).toBe(200);
    expect(first.body.readAt).not.toBeNull();

    // Second call on an already-read notification is a no-op, not a
    // conflict — unlike Yellow Zone's claim/resolve, there is no
    // meaningful "someone else got there first" race to surface here.
    const second = await request(app)
      .patch(`/api/v1/notifications/${id}/read`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(second.status).toBe(200);

    const count = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(count.body.count).toBe(0);
  });

  it('returns 404 for a notification that does not exist', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner } = await escalate(app, container);

    const response = await request(app)
      .patch('/api/v1/notifications/does-not-exist/read')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(response.status).toBe(404);
  });

  it('mark-all-read is atomic and only touches the calling user\'s unread notifications', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);

    // Two separate escalations -> two separate notifications for the same
    // owner.
    await placeAndResolve(container, owner, assignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });
    const { assignmentId: secondAssignmentId } = await (async () => {
      const shipResponse = await request(app)
        .post('/api/v1/ships')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          shipName: 'Second Ship',
          truckRequirements: [{ destination: 'Muscat, Oman', truckType: 'Flatbed', quantityNeeded: 1 }],
        });
      const truckRequirementId = shipResponse.body.truckRequirements[0].id as string;
      const driverResponse = await request(app)
        .post('/api/v1/drivers')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ fullName: 'Second Driver', phone: '+92 300 7654321', truckType: 'Flatbed' });
      const assignmentResponse = await request(app)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ truckRequirementId, driverId: driverResponse.body.id });
      return { assignmentId: assignmentResponse.body.id as string };
    })();
    await placeAndResolve(container, owner, secondAssignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    const before = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(before.body.count).toBe(2);

    const markAll = await request(app)
      .patch('/api/v1/notifications/mark-all-read')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(markAll.body).toEqual({ count: 2 });

    const after = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(after.body.count).toBe(0);
  });
});

describe('notification module — idempotency', () => {
  it('never creates a duplicate notification for a duplicate webhook delivery', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    await placeAndResolve(container, owner, assignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    const placement = await prisma.voiceCallPlacement.findFirstOrThrow({ where: { assignmentId } });
    // A second, distinct webhook event id for the same already-resolved
    // call — the same "duplicate delivery" shape yellow-zone.test.ts's own
    // idempotency test uses, extended here to also prove the notification
    // fan-out doesn't double.
    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: `evt-duplicate-${placement.externalCallId}`,
      externalCallId: placement.externalCallId,
    });

    const list = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(list.body.items).toHaveLength(1);
  });
});

describe('notification module — pagination', () => {
  it('paginates and orders newest first', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    await placeAndResolve(container, owner, assignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    const page1 = await request(app)
      .get('/api/v1/notifications')
      .query({ page: 1, pageSize: 1 })
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.total).toBe(1);
    expect(page1.body.totalPages).toBe(1);

    const page2 = await request(app)
      .get('/api/v1/notifications')
      .query({ page: 2, pageSize: 1 })
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(page2.body.items).toHaveLength(0);
  });

  it('filters by unreadOnly', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner } = await escalate(app, container);

    await request(app)
      .patch('/api/v1/notifications/mark-all-read')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const unreadOnly = await request(app)
      .get('/api/v1/notifications')
      .query({ unreadOnly: 'true' })
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(unreadOnly.body.items).toHaveLength(0);

    const all = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(all.body.items).toHaveLength(1);
  });
});

// Phase 6 audit Finding 1: unreadOnly used z.coerce.boolean(), which
// coerces via JS truthiness — "false" is a non-empty string, so it parsed
// to `true` and silently inverted the filter. Each case below pins down
// the exact required contract (absent -> both; "true" -> unread only;
// "false" -> both, not "unread only" again; anything else -> a clean 400,
// not a silent guess) — the "false" and "invalid" cases are the two that
// fail against the old z.coerce.boolean() implementation.
describe('notification module — unreadOnly query parameter (Phase 6 audit Finding 1)', () => {
  async function setUpOneReadOneUnread(
    app: ReturnType<typeof buildAppWithContainer>['app'],
    container: ReturnType<typeof buildAppWithContainer>['container'],
  ) {
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    await placeAndResolve(container, owner, assignmentId, {
      kind: 'system_error',
      reason: 'First escalation — will be marked read.',
    });
    const first = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    await request(app)
      .patch(`/api/v1/notifications/${first.body.items[0].id}/read`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const shipResponse = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        shipName: 'Second Ship',
        truckRequirements: [{ destination: 'Muscat, Oman', truckType: 'Flatbed', quantityNeeded: 1 }],
      });
    const truckRequirementId = shipResponse.body.truckRequirements[0].id as string;
    const driverResponse = await request(app)
      .post('/api/v1/drivers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ fullName: 'Second Driver', phone: '+92 300 7654321', truckType: 'Flatbed' });
    const secondAssignment = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId, driverId: driverResponse.body.id });
    await placeAndResolve(container, owner, secondAssignment.body.id, {
      kind: 'system_error',
      reason: 'Second escalation — stays unread.',
    });

    return owner;
  }

  it('omitted -> returns every notification, read and unread alike', async () => {
    const { app, container } = buildAppWithContainer();
    const owner = await setUpOneReadOneUnread(app, container);

    const response = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
  });

  it('unreadOnly=true -> returns only the unread notification', async () => {
    const { app, container } = buildAppWithContainer();
    const owner = await setUpOneReadOneUnread(app, container);

    const response = await request(app)
      .get('/api/v1/notifications')
      .query({ unreadOnly: 'true' })
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].readAt).toBeNull();
  });

  // This is the exact case the audit found broken: z.coerce.boolean()
  // parsed the string "false" as `true` (non-empty string -> truthy),
  // so this request used to silently return only the unread item instead
  // of both.
  it('unreadOnly=false -> returns every notification, same as omitting it', async () => {
    const { app, container } = buildAppWithContainer();
    const owner = await setUpOneReadOneUnread(app, container);

    const response = await request(app)
      .get('/api/v1/notifications')
      .query({ unreadOnly: 'false' })
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
  });

  it.each(['0', '1', 'yes', 'no', 'FALSE', 'True', 'random'])(
    'unreadOnly=%s -> rejected with 400, not silently guessed',
    async (value) => {
      const { app, container } = buildAppWithContainer();
      const owner = await setUpOneReadOneUnread(app, container);

      const response = await request(app)
        .get('/api/v1/notifications')
        .query({ unreadOnly: value })
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    },
  );
});
