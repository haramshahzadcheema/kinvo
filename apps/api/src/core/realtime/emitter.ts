import type {
  NotificationRealtimePayload,
  RealtimeEventName,
  YellowZoneRealtimePayload,
} from '@kinvo/contracts';
import { Emitter } from '@socket.io/redis-emitter';
import Redis from 'ioredis';
import { env } from '../../config/env';
import { logger } from '../logger';

// A single union, not two separately-typed emit functions each hardcoded
// to one payload shape — Phase 6 is the second producer through this same
// emitter (the first payload shape Yellow Zone needed), and the room
// target (organization vs. user) is an orthogonal concern from what the
// payload contains.
export type RealtimePayload = YellowZoneRealtimePayload | NotificationRealtimePayload;

export type EmitToOrganization = (
  organizationId: string,
  event: RealtimeEventName,
  payload: RealtimePayload,
) => void;

export type EmitToUser = (userId: string, event: RealtimeEventName, payload: RealtimePayload) => void;

// A dedicated, process-wide connection — same reasoning as
// core/queue/queueConnection.ts's own comment: every `createContainer()`
// call constructs a fresh set of services (see test/support/app.ts, called
// once per test), and this module-level singleton is what keeps that from
// opening a new Redis connection per test. `lazyConnect: true` means it
// never actually connects at all for the large majority of tests that
// never touch a code path that emits.
export const emitterRedisClient = new Redis(env.REDIS_URL, { lazyConnect: true });
emitterRedisClient.on('error', (error) => logger.error({ err: error }, 'Realtime emitter Redis error'));

function organizationRoom(organizationId: string): string {
  return `org:${organizationId}`;
}

// Mirrors socketServer.ts's own userRoom() naming exactly — the two files
// already duplicate organizationRoom() the same way (publish side vs.
// subscribe side, never imported from one into the other, matching this
// codebase's existing precedent rather than introducing a new shared
// room-naming module for what's a one-line string template).
function userRoom(userId: string): string {
  return `user:${userId}`;
}

// Pulls whatever id is useful for the debug log out of either payload
// shape, without the log line needing to know which producer is calling —
// never logs the payload itself (see the doc comment below for why).
function targetIdFor(payload: RealtimePayload): string | undefined {
  if ('item' in payload) return payload.item.id;
  if ('notification' in payload) return payload.notification?.id;
  return undefined;
}

/**
 * The publish side of Phase 5's realtime layer — deliberately independent
 * of `core/realtime/socketServer.ts`'s `SocketIOServer` (which only the API
 * process ever runs). `@socket.io/redis-emitter` speaks the exact same
 * Redis pub/sub protocol `@socket.io/redis-adapter` listens on, so a
 * process with no Socket.io server of its own — the worker, where
 * `voice.service.ts`'s escalation path actually runs (see that file's
 * `VoiceService` doc comments: "Worker-invoked") — can still reach browser
 * clients connected to the API process. `core/container.ts` constructs
 * this once and hands the same `emitToOrganization`/`emitToUser` functions
 * to every service that needs them, regardless of which process
 * (`server.ts` or `worker.ts`) is currently running.
 *
 * `emitToUser` (Phase 6) targets the per-user room `socketServer.ts` joins
 * every connection to alongside the organization room — for notifications,
 * which are per-recipient-private, not organization-wide like Yellow Zone.
 */
export function createRealtimeEmitter(): {
  emitToOrganization: EmitToOrganization;
  emitToUser: EmitToUser;
} {
  const emitter = new Emitter(emitterRedisClient);

  const emitToOrganization: EmitToOrganization = (organizationId, event, payload) => {
    // Debug-level, not info — this fires on every Yellow Zone/notification
    // state transition, so it's noise at the default LOG_LEVEL, but the
    // one signal an on-call engineer actually needs when a user reports
    // "it didn't update live": whether a publish was attempted at all, for
    // which org/item. Never the payload itself — a Yellow Zone item's
    // driverPhone or a notification's message text is real content, not
    // debugging metadata, and there's no debugging value in it beyond what
    // organizationId/targetId already gives. `@socket.io/redis-emitter`'s
    // `.emit()` doesn't surface success/failure back to the caller (it's a
    // fire-and-forget Redis PUBLISH under the hood, matching Socket.io's
    // own emit semantics) — see emitterRedisClient's own `error` handler
    // above for the one failure signal that IS observable, a dead Redis
    // connection.
    logger.debug(
      { event, organizationId, targetId: targetIdFor(payload) },
      'Realtime event emitted to organization room.',
    );
    emitter.to(organizationRoom(organizationId)).emit(event, payload);
  };

  const emitToUser: EmitToUser = (userId, event, payload) => {
    logger.debug({ event, targetId: targetIdFor(payload) }, 'Realtime event emitted to user room.');
    emitter.to(userRoom(userId)).emit(event, payload);
  };

  return { emitToOrganization, emitToUser };
}
