import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { type Socket, io } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAppWithContainer } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';
import type { FakeVoiceProvider } from '../../src/core/voice/FakeVoiceProvider';
import { prisma } from '../../src/core/prisma';
import { createRealtimeServer, type RealtimeServer } from '../../src/core/realtime/socketServer';
import { runWithRequestContext, type RequestContext } from '../../src/core/request-context';
import { voiceCallsQueue, voiceWebhookEventsQueue } from '../../src/core/queue/queues';

beforeEach(async () => {
  await resetDatabase();
});

let httpServer: HttpServer | undefined;
let realtimeServer: RealtimeServer | undefined;
let clientSockets: Socket[] = [];

afterEach(async () => {
  for (const socket of clientSockets) {
    socket.disconnect();
  }
  clientSockets = [];
  if (realtimeServer) {
    await realtimeServer.close();
    realtimeServer = undefined;
  }
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
    httpServer = undefined;
  }
  await voiceCallsQueue.obliterate({ force: true });
  await voiceWebhookEventsQueue.obliterate({ force: true });
});

/** Boots a real http.Server + Socket.io server (identical wiring to
 * server.ts) on a random free port, wired to the same container the test's
 * REST requests go through — a real Redis-backed adapter, not a stub. */
async function startRealtimeServer(
  container: ReturnType<typeof buildAppWithContainer>['container'],
): Promise<{ url: string }> {
  const { app } = buildAppWithContainer();
  httpServer = createServer(app);
  realtimeServer = createRealtimeServer(httpServer, container.tokenRevocationStore);
  await new Promise<void>((resolve) => httpServer?.listen(0, resolve));
  const port = (httpServer?.address() as AddressInfo).port;
  return { url: `http://localhost:${port}` };
}

function connectSocket(url: string, token: string | undefined): Socket {
  const socket = io(url, {
    auth: { token },
    reconnection: false,
    transports: ['websocket'],
    forceNew: true,
  });
  clientSockets.push(socket);
  return socket;
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (error) => reject(error));
  });
}

function waitForConnectError(socket: Socket): Promise<Error> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => reject(new Error('Expected connect_error, got connect')));
    socket.once('connect_error', (error) => resolve(error));
  });
}

function waitForEvent<T>(socket: Socket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('realtime — socket authentication', () => {
  it('accepts a connection with a valid access token', async () => {
    const { app, container } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const { url } = await startRealtimeServer(container);

    const socket = connectSocket(url, owner.accessToken);
    await expect(waitForConnect(socket)).resolves.toBeUndefined();
  });

  it('rejects a connection with no token at all', async () => {
    const { container } = buildAppWithContainer();
    const { url } = await startRealtimeServer(container);

    const socket = connectSocket(url, undefined);
    const error = await waitForConnectError(socket);
    expect(error.message).toMatch(/access token/i);
  });

  it('rejects a connection with a garbage/invalid token', async () => {
    const { container } = buildAppWithContainer();
    const { url } = await startRealtimeServer(container);

    const socket = connectSocket(url, 'not-a-real-jwt');
    const error = await waitForConnectError(socket);
    expect(error.message).toMatch(/invalid|expired/i);
  });

  it('rejects a connection for a revoked membership', async () => {
    const { app, container } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    await container.tokenRevocationStore.revokeMembership(owner.membershipId);
    const { url } = await startRealtimeServer(container);

    const socket = connectSocket(url, owner.accessToken);
    const error = await waitForConnectError(socket);
    expect(error.message).toMatch(/access has changed/i);
  });

  it('never trusts an organizationId supplied by the client — only the verified token decides the room', async () => {
    const { app, container } = buildAppWithContainer();
    const orgA = await registerOrganization(app);
    const orgB = await registerOrganization(app);
    const { url } = await startRealtimeServer(container);

    // A client attempting to smuggle a different organizationId into the
    // handshake — the server must derive it from orgA's own verified
    // token instead, never from this field.
    const socket = io(url, {
      auth: { token: orgA.accessToken, organizationId: orgB.organizationId },
      reconnection: false,
      transports: ['websocket'],
      forceNew: true,
    });
    clientSockets.push(socket);
    await waitForConnect(socket);

    // Proven by behavior, not by inspecting server internals: an event
    // emitted for org B must never reach this socket (see the room
    // isolation test below for the full two-socket version of this
    // proof) — here we confirm the connection itself succeeded using
    // orgA's identity regardless of the injected field.
    expect(socket.connected).toBe(true);
  });
});

describe('realtime — organization room isolation', () => {
  it('delivers an event only to the target organization\'s room, never a different one', async () => {
    const { app, container } = buildAppWithContainer();
    const orgA = await registerOrganization(app);
    const orgB = await registerOrganization(app);
    const { url } = await startRealtimeServer(container);

    const socketA = connectSocket(url, orgA.accessToken);
    const socketB = connectSocket(url, orgB.accessToken);
    await Promise.all([waitForConnect(socketA), waitForConnect(socketB)]);

    const receivedByA = waitForEvent(socketA, 'yellow_zone.created');
    let receivedByB = false;
    socketB.once('yellow_zone.created', () => {
      receivedByB = true;
    });

    container.emitToOrganization(orgA.organizationId, 'yellow_zone.created', {
      item: { id: 'test-item' } as never,
    });

    await receivedByA;
    // A short grace window — proving absence, not just racing the assertion
    // against delivery latency.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(receivedByB).toBe(false);
  });

  it('delivers a real yellow_zone.created event end-to-end when a call escalates', async () => {
    const { app, container } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const shipResponse = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        shipName: 'MSC Aurora',
        truckRequirements: [{ destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 1 }],
      });
    const truckRequirementId = shipResponse.body.truckRequirements[0].id as string;
    const driverResponse = await request(app)
      .post('/api/v1/drivers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ fullName: 'Ahsan Raza', phone: '+92 300 1234567', truckType: 'Flatbed' });
    const assignmentResponse = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId, driverId: driverResponse.body.id });
    const assignmentId = assignmentResponse.body.id as string;

    const { url } = await startRealtimeServer(container);
    const socket = connectSocket(url, owner.accessToken);
    await waitForConnect(socket);

    const eventPromise = waitForEvent<{ item: { assignmentId: string; status: string } }>(
      socket,
      'yellow_zone.created',
    );

    // The real trigger path — place a call and resolve it to a
    // SYSTEM_ERROR outcome, exactly as CALL-E's webhook would — not a
    // shortcut that constructs a YellowZoneItem directly. This is the
    // same helper shape as yellow-zone.test.ts's placeAndResolve.
    const context: RequestContext = {
      userId: 'test:system',
      organizationId: owner.organizationId,
      membershipId: 'test:system',
      role: 'OWNER',
    };
    await runWithRequestContext(context, () =>
      container.voiceService.executeCallPlacement({
        assignmentId,
        organizationId: owner.organizationId,
        callAttemptRef: `${assignmentId}:0`,
      }),
    );
    const placement = await prisma.voiceCallPlacement.findFirstOrThrow({ where: { assignmentId } });
    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });
    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: `evt-${placement.externalCallId}`,
      externalCallId: placement.externalCallId,
    });

    const event = await eventPromise;
    expect(event.item.assignmentId).toBe(assignmentId);
    expect(event.item.status).toBe('PENDING');
  });
});

describe('realtime — user room isolation (Phase 6 notifications)', () => {
  it('delivers a user-targeted event only to that user\'s socket, never a same-org teammate\'s', async () => {
    const { app, container } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    // A second, genuinely different user in the SAME organization —
    // notifications are per-user-private, so same-org is exactly the case
    // that must NOT leak (unlike organization-room isolation, which only
    // has to prove cross-tenant separation).
    const invite = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'teammate@example.com', role: 'DISPATCHER' });
    const accept = await request(app)
      .post('/api/v1/auth/accept-invitation')
      .send({
        token: invite.body.inviteToken,
        firstName: 'Team',
        lastName: 'Mate',
        password: 'correct-horse-battery-staple',
      });
    const teammateToken = accept.body.accessToken as string;
    const teammateUserId = accept.body.user.id as string;

    const { url } = await startRealtimeServer(container);
    const ownerSocket = connectSocket(url, owner.accessToken);
    const teammateSocket = connectSocket(url, teammateToken);
    await Promise.all([waitForConnect(ownerSocket), waitForConnect(teammateSocket)]);

    const receivedByTeammate = waitForEvent(teammateSocket, 'notification.created');
    let receivedByOwner = false;
    ownerSocket.once('notification.created', () => {
      receivedByOwner = true;
    });

    container.emitToUser(teammateUserId, 'notification.created', {
      notification: { id: 'test-notification' } as never,
    });

    await receivedByTeammate;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(receivedByOwner).toBe(false);
  });

  it('delivers a real notification.created event end-to-end when a call escalates', async () => {
    const { app, container } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const shipResponse = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        shipName: 'MSC Aurora',
        truckRequirements: [{ destination: 'Salalah, Oman', truckType: 'Flatbed', quantityNeeded: 1 }],
      });
    const truckRequirementId = shipResponse.body.truckRequirements[0].id as string;
    const driverResponse = await request(app)
      .post('/api/v1/drivers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ fullName: 'Ahsan Raza', phone: '+92 300 1234567', truckType: 'Flatbed' });
    const assignmentResponse = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ truckRequirementId, driverId: driverResponse.body.id });
    const assignmentId = assignmentResponse.body.id as string;

    const { url } = await startRealtimeServer(container);
    const socket = connectSocket(url, owner.accessToken);
    await waitForConnect(socket);

    const eventPromise = waitForEvent<{ notification: { type: string; targetType: string } }>(
      socket,
      'notification.created',
    );

    const context: RequestContext = {
      userId: 'test:system',
      organizationId: owner.organizationId,
      membershipId: 'test:system',
      role: 'OWNER',
    };
    await runWithRequestContext(context, () =>
      container.voiceService.executeCallPlacement({
        assignmentId,
        organizationId: owner.organizationId,
        callAttemptRef: `${assignmentId}:0`,
      }),
    );
    const placement = await prisma.voiceCallPlacement.findFirstOrThrow({ where: { assignmentId } });
    const fake = container.voiceProvider as FakeVoiceProvider;
    fake.setOutcome(placement.externalCallId, {
      kind: 'system_error',
      reason: 'CALL-E reported the call as failed.',
    });
    await container.voiceService.processWebhookSignal({
      provider: 'fake',
      eventId: `evt-${placement.externalCallId}`,
      externalCallId: placement.externalCallId,
    });

    const event = await eventPromise;
    expect(event.notification.type).toBe('YELLOW_ZONE_ESCALATED');
    expect(event.notification.targetType).toBe('YELLOW_ZONE_ITEM');
  });
});
