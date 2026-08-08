import type { RealtimeEventName, YellowZoneRealtimePayload } from '@kinvo/contracts';
import { Emitter } from '@socket.io/redis-emitter';
import Redis from 'ioredis';
import { env } from '../../config/env';
import { logger } from '../logger';

export type EmitToOrganization = (
  organizationId: string,
  event: RealtimeEventName,
  payload: YellowZoneRealtimePayload,
) => void;

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

/**
 * The publish side of Phase 5's realtime layer — deliberately independent
 * of `core/realtime/socketServer.ts`'s `SocketIOServer` (which only the API
 * process ever runs). `@socket.io/redis-emitter` speaks the exact same
 * Redis pub/sub protocol `@socket.io/redis-adapter` listens on, so a
 * process with no Socket.io server of its own — the worker, where
 * `voice.service.ts`'s escalation path actually runs (see that file's
 * `VoiceService` doc comments: "Worker-invoked") — can still reach browser
 * clients connected to the API process. `core/container.ts` constructs
 * this once and hands the same `emitToOrganization` function to both
 * `voiceService` and `yellowZoneService`, regardless of which process
 * (`server.ts` or `worker.ts`) is currently running.
 */
export function createRealtimeEmitter(): { emitToOrganization: EmitToOrganization } {
  const emitter = new Emitter(emitterRedisClient);

  const emitToOrganization: EmitToOrganization = (organizationId, event, payload) => {
    emitter.to(organizationRoom(organizationId)).emit(event, payload);
  };

  return { emitToOrganization };
}
