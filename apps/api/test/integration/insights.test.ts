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

async function setUpShipAndDriver(app: ReturnType<typeof buildAppWithContainer>['app']) {
  const owner = await registerOrganization(app);
  const shipResponse = await request(app)
    .post('/api/v1/ships')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({
      shipName: 'MSC Aurora',
      truckRequirements: [{ destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 2 }],
    });
  const truckRequirementId = shipResponse.body.truckRequirements[0].id as string;
  return { owner, truckRequirementId };
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
}

describe('insights module — empty state', () => {
  it('is an honest empty list when there is not enough real activity yet', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .get('/api/v1/insights/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.insights).toEqual([]);
  });

  it('rejects an unauthenticated request', async () => {
    const { app } = buildAppWithContainer();
    await request(app).get('/api/v1/insights/summary').expect(401);
  });
});

describe('insights module — driver reliability', () => {
  it('surfaces a driver with 2+ negative outcomes as a real outlier', async () => {
    const { app } = buildAppWithContainer();
    const { owner, truckRequirementId } = await setUpShipAndDriver(app);
    const driver = await request(app)
      .post('/api/v1/drivers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ fullName: 'Ahmed Ali', phone: '+92 300 1234567', truckType: 'Flatbed' });

    // Re-approaching a driver after an earlier rejection is a real,
    // supported workflow — see Assignment's own partial-unique-index
    // comment — so both rejections can target the same requirement.
    for (let i = 0; i < 2; i += 1) {
      const assignment = await request(app)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ truckRequirementId, driverId: driver.body.id });
      await request(app)
        .patch(`/api/v1/assignments/${assignment.body.id}/reject`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ reason: 'Not available' });
    }

    const response = await request(app)
      .get('/api/v1/insights/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const insight = response.body.insights.find((i: { id: string }) => i.id === 'driver_reliability');
    expect(insight).toBeDefined();
    expect(insight.observation).toContain('Ahmed Ali');
    expect(insight.observation).toContain('2');
  });

  it('does not surface a driver with only 1 negative outcome — not a pattern yet', async () => {
    const { app } = buildAppWithContainer();
    const { owner, truckRequirementId } = await setUpShipAndDriver(app);
    const driver = await request(app)
      .post('/api/v1/drivers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ fullName: 'Ahmed Ali', phone: '+92 300 1234567', truckType: 'Flatbed' });
    const assignment = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId, driverId: driver.body.id });
    await request(app)
      .patch(`/api/v1/assignments/${assignment.body.id}/reject`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ reason: 'Not available' });

    const response = await request(app)
      .get('/api/v1/insights/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(
      response.body.insights.find((i: { id: string }) => i.id === 'driver_reliability'),
    ).toBeUndefined();
  });
});

describe('insights module — escalation timing', () => {
  it('surfaces a real hour-of-day concentration once there is enough sample', async () => {
    const { app, container } = buildAppWithContainer();
    const owner = await registerOrganization(app);

    for (let i = 0; i < 5; i += 1) {
      const shipResponse = await request(app)
        .post('/api/v1/ships')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          shipName: `Ship ${i}`,
          truckRequirements: [{ destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 1 }],
        });
      const driver = await request(app)
        .post('/api/v1/drivers')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ fullName: `Driver ${i}`, phone: `+92 300 000000${i}`, truckType: 'Flatbed' });
      const assignment = await request(app)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          truckRequirementId: shipResponse.body.truckRequirements[0].id,
          driverId: driver.body.id,
        });
      await placeAndResolve(container, owner, assignment.body.id, {
        kind: 'system_error',
        reason: 'CALL-E reported the call as failed.',
      });
    }

    // All 5 escalations really happened within the same test run, a few
    // hundred milliseconds apart — in practice they land in the same
    // real UTC hour without needing to fabricate one, so the peak-hour
    // detection has an unambiguous, fully concentrated (100%) real
    // signal to find.
    const response = await request(app)
      .get('/api/v1/insights/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const insight = response.body.insights.find((i: { id: string }) => i.id === 'escalation_timing');
    expect(insight).toBeDefined();
    expect(insight.observation).toContain('100%');
    expect(insight.observation).toContain('(5 of 5)');
  });

  it('does not surface a timing insight below the minimum sample size', async () => {
    const { app, container } = buildAppWithContainer();
    const { owner, truckRequirementId } = await setUpShipAndDriver(app);
    const driver = await request(app)
      .post('/api/v1/drivers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ fullName: 'Ahmed Ali', phone: '+92 300 1234567', truckType: 'Flatbed' });
    const assignment = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId, driverId: driver.body.id });
    await placeAndResolve(container, owner, assignment.body.id, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });

    const response = await request(app)
      .get('/api/v1/insights/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(
      response.body.insights.find((i: { id: string }) => i.id === 'escalation_timing'),
    ).toBeUndefined();
  });
});

describe('insights module — transcript keyword themes', () => {
  it('surfaces a real keyword theme once enough driver turns mention it', async () => {
    const { app, container } = buildAppWithContainer();
    const owner = await registerOrganization(app);

    for (let i = 0; i < 3; i += 1) {
      const shipResponse = await request(app)
        .post('/api/v1/ships')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          shipName: `Ship ${i}`,
          truckRequirements: [{ destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 1 }],
        });
      const driver = await request(app)
        .post('/api/v1/drivers')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ fullName: `Driver ${i}`, phone: `+92 300 000000${i}`, truckType: 'Flatbed' });
      const assignment = await request(app)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          truckRequirementId: shipResponse.body.truckRequirements[0].id,
          driverId: driver.body.id,
        });
      await placeAndResolve(container, owner, assignment.body.id, {
        kind: 'confirmed',
        transcript: {
          summary: 'Driver confirmed after asking about pay.',
          turns: [
            { speaker: 'bot', text: 'Can you take this job?', offsetSeconds: 0 },
            { speaker: 'user', text: 'What is the payment for this route?', offsetSeconds: 2 },
          ],
        },
      });
    }

    const response = await request(app)
      .get('/api/v1/insights/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const insight = response.body.insights.find((i: { id: string }) => i.id === 'transcript_keywords');
    expect(insight).toBeDefined();
    expect(insight.observation).toContain('payment or rate');
    expect(insight.observation).toContain('3');
  });
});

describe('insights module — tenant isolation and RBAC', () => {
  it("never mixes one organization's driver history into another's insight", async () => {
    const { app } = buildAppWithContainer();
    const orgA = await setUpShipAndDriver(app);
    const driverA = await request(app)
      .post('/api/v1/drivers')
      .set('Authorization', `Bearer ${orgA.owner.accessToken}`)
      .send({ fullName: 'Ahmed Ali', phone: '+92 300 1234567', truckType: 'Flatbed' });
    for (let i = 0; i < 2; i += 1) {
      const assignment = await request(app)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${orgA.owner.accessToken}`)
        .send({ truckRequirementId: orgA.truckRequirementId, driverId: driverA.body.id });
      await request(app)
        .patch(`/api/v1/assignments/${assignment.body.id}/reject`)
        .set('Authorization', `Bearer ${orgA.owner.accessToken}`)
        .send({ reason: 'Not available' });
    }

    const orgB = await registerOrganization(app);
    const response = await request(app)
      .get('/api/v1/insights/summary')
      .set('Authorization', `Bearer ${orgB.accessToken}`);

    expect(response.body.insights).toEqual([]);
  });

  it('a VIEWER can read insights', async () => {
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
      .get('/api/v1/insights/summary')
      .set('Authorization', `Bearer ${accept.body.accessToken}`)
      .expect(200);
  });
});
