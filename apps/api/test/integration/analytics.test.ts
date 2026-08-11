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

afterAll(async () => {
  await voiceCallsQueue.obliterate({ force: true });
  await voiceWebhookEventsQueue.obliterate({ force: true });
});

function systemContextFor(owner: { organizationId: string }): RequestContext {
  return {
    userId: 'test:system',
    organizationId: owner.organizationId,
    membershipId: 'test:system',
    role: 'OWNER',
  };
}

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

async function placeAndResolve(
  container: ReturnType<typeof buildAppWithContainer>['container'],
  owner: { organizationId: string },
  assignmentId: string,
  outcome: Parameters<FakeVoiceProvider['setOutcome']>[1],
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
  return placement;
}

describe('analytics module — real aggregates over today', () => {
  it('counts a confirmed call as automated and resolved, reflected in both the stat and the daily series', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    await placeAndResolve(container, owner, assignmentId, { kind: 'confirmed' });

    const response = await request(app)
      .get('/api/v1/analytics/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.days).toBe(7);
    const callsStat = response.body.stats.find((s: { key: string }) => s.key === 'calls_automated');
    expect(callsStat.value).toBe('1');
    const today = new Date().toISOString().slice(0, 10);
    const todayVolume = response.body.dailyCallVolume.find((d: { date: string }) => d.date === today);
    expect(todayVolume).toMatchObject({ automated: 1, escalated: 0 });
    expect(todayVolume).toBeDefined();

    const resolutionStat = response.body.stats.find((s: { key: string }) => s.key === 'resolution_rate');
    expect(resolutionStat.value).toBe('100%');
  });

  it('counts an escalated (SYSTEM_ERROR) call as escalated, not automated, and creates a real Yellow Zone item by priority', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    await placeAndResolve(container, owner, assignmentId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    const response = await request(app)
      .get('/api/v1/analytics/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const today = new Date().toISOString().slice(0, 10);
    const todayVolume = response.body.dailyCallVolume.find((d: { date: string }) => d.date === today);
    expect(todayVolume).toMatchObject({ automated: 0, escalated: 1 });

    const resolutionStat = response.body.stats.find((s: { key: string }) => s.key === 'resolution_rate');
    expect(resolutionStat.value).toBe('0%');

    const yzStat = response.body.stats.find((s: { key: string }) => s.key === 'yellow_zone_escalations');
    expect(yzStat.value).toBe('1');
    // "CALL-E reported the call as failed" is classified HIGH by
    // escalationClassification.ts — a real, already-computed priority,
    // not a value this test invents.
    const high = response.body.yellowZoneByPriority.find(
      (p: { priority: string }) => p.priority === 'HIGH',
    );
    expect(high.count).toBe(1);
  });

  it('computes a real average resolve time from placedAt/resolvedAt', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    const placement = await placeAndResolve(container, owner, assignmentId, { kind: 'confirmed' });

    // Backdate placedAt so the resolved duration is a known, non-zero
    // value — placeAndResolve itself resolves near-instantly, which
    // would make every duration ~0s and unable to prove the subtraction
    // is wired correctly.
    await prisma.voiceCallPlacement.update({
      where: { id: placement.id },
      data: { placedAt: new Date(Date.now() - 90_000) },
    });

    const response = await request(app)
      .get('/api/v1/analytics/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const avgStat = response.body.stats.find((s: { key: string }) => s.key === 'avg_time_to_resolve');
    expect(avgStat.value).toBe('1m 30s');
  });

  it('rejects an unauthenticated request', async () => {
    const { app } = buildAppWithContainer();
    await request(app).get('/api/v1/analytics/summary').expect(401);
  });

  it('a VIEWER can read analytics', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
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

    await request(app)
      .get('/api/v1/analytics/summary')
      .set('Authorization', `Bearer ${accept.body.accessToken}`)
      .expect(200);
  });

  it("never mixes one organization's calls into another's aggregates", async () => {
    const { app, container } = buildAppWithContainer();
    const orgA = await setUpPendingAssignment(app);
    await placeAndResolve(container, orgA.owner, orgA.assignmentId, { kind: 'confirmed' });

    const orgB = await setUpPendingAssignment(app);
    const response = await request(app)
      .get('/api/v1/analytics/summary')
      .set('Authorization', `Bearer ${orgB.owner.accessToken}`);

    const callsStat = response.body.stats.find((s: { key: string }) => s.key === 'calls_automated');
    expect(callsStat.value).toBe('0');
  });
});

describe('analytics module — comparison to the prior period', () => {
  it('is null when the prior period has no data, and a real percentage once it does', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId: firstAssignmentId } = await setUpPendingAssignment(app);
    await placeAndResolve(container, owner, firstAssignmentId, { kind: 'confirmed' });

    const noPriorData = await request(app)
      .get('/api/v1/analytics/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const firstStat = noPriorData.body.stats.find((s: { key: string }) => s.key === 'calls_automated');
    expect(firstStat.deltaPct).toBeNull();

    // Backdate this same attempt into the PRIOR 7-day window (8 days
    // ago), then add a second, current-window attempt — now the prior
    // period has exactly 1 call and the current period has 1, a real,
    // computable 0% delta rather than a null one.
    await prisma.assignmentAttempt.updateMany({
      where: { assignmentId: firstAssignmentId },
      data: { attemptedAt: new Date(Date.now() - 8 * 86_400_000) },
    });

    const shipResponse = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        shipName: 'CMA Zeus',
        truckRequirements: [{ destination: 'Muscat, Oman', truckType: 'Flatbed', quantityNeeded: 1 }],
      });
    const secondTruckRequirementId = shipResponse.body.truckRequirements[0].id as string;
    const secondDriver = await request(app)
      .post('/api/v1/drivers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ fullName: 'Bilal Khan', phone: '+92 300 7654321', truckType: 'Flatbed' });
    const secondAssignment = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId: secondTruckRequirementId, driverId: secondDriver.body.id });
    await placeAndResolve(container, owner, secondAssignment.body.id, { kind: 'confirmed' });

    const withPriorData = await request(app)
      .get('/api/v1/analytics/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const secondStat = withPriorData.body.stats.find((s: { key: string }) => s.key === 'calls_automated');
    expect(secondStat.value).toBe('1');
    expect(secondStat.deltaPct).toBe(0);
  });

  it("excludes a call from 8 days ago from today's daily series but still counts it toward the prior-period comparison", async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, assignmentId } = await setUpPendingAssignment(app);
    await placeAndResolve(container, owner, assignmentId, { kind: 'confirmed' });
    await prisma.assignmentAttempt.updateMany({
      where: { assignmentId },
      data: { attemptedAt: new Date(Date.now() - 8 * 86_400_000) },
    });

    const response = await request(app)
      .get('/api/v1/analytics/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.body.dailyCallVolume.every((d: { automated: number }) => d.automated === 0)).toBe(
      true,
    );
    const callsStat = response.body.stats.find((s: { key: string }) => s.key === 'calls_automated');
    expect(callsStat.value).toBe('0');
  });
});
