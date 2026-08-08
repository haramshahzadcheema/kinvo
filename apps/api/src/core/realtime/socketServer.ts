import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server as SocketIOServer } from 'socket.io';
import { env } from '../../config/env';
import { logger } from '../logger';
import { resolveAuthenticatedContext } from '../security/resolveAuthenticatedContext';
import type { TokenRevocationStore } from '../security/token-revocation';

export interface RealtimeServer {
  io: SocketIOServer;
  close(): Promise<void>;
}

function organizationRoom(organizationId: string): string {
  return `org:${organizationId}`;
}

/**
 * Accepts browser Socket.io connections for the API process only — the
 * *publish* side (`emitToOrganization`) lives in `core/realtime/emitter.ts`
 * instead, deliberately decoupled from this server. `voice.service.ts`'s
 * escalation path runs inside the *worker* process (see
 * `VoiceService`'s own "Worker-invoked" doc comments), which has no HTTP
 * server and therefore can never host a `SocketIOServer` of its own — it
 * only ever needs to publish, never to accept a connection. Splitting the
 * two means `core/container.ts` (shared by `server.ts`, `worker.ts`, and
 * every test) can construct `emitToOrganization` from nothing but a Redis
 * connection, with no dependency on an `http.Server` that only `server.ts`
 * ever has.
 *
 * Sockets are a cache-invalidation signal for TanStack Query, never a
 * parallel state system — REST + Postgres remain the source of truth (see
 * docs/ARCHITECTURE.md's Phase 5 realtime section).
 *
 * Authenticated the same way REST requests are — `resolveAuthenticatedContext`
 * is the exact function `authenticate.ts` calls, so the two transports can
 * never verify a token differently. `organizationId` is never read from
 * anything the client sends (not `socket.handshake.auth.organizationId` or
 * any equivalent); the only room a socket ever joins is derived from its
 * own verified token.
 *
 * A revoked/expired token is only checked at connect time, not on a
 * mid-session timer — an already-established connection is not re-verified
 * for the rest of its lifetime, only at each (re)connect. What bounds this
 * in practice: the frontend's `connectSocket` (apps/web/src/lib/socket.ts)
 * reads the current access token fresh on every connection attempt,
 * including automatic reconnects, and `RealtimeProvider`'s `connect_error`
 * handler proactively redeems the refresh-token cookie the moment a
 * (re)connect is rejected for an expired token, then retries immediately —
 * so an established connection can go stale for as long as it stays
 * connected, but every reconnect attempt self-heals rather than repeating
 * the same expired token indefinitely. Adding a per-socket expiry timer to
 * also bound an already-connected socket's staleness was considered and
 * left out — see the Phase 5 hardening-pass entry in the Decisions log.
 */
export function createRealtimeServer(
  httpServer: HttpServer,
  tokenRevocationStore: TokenRevocationStore,
): RealtimeServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN, credentials: true },
  });

  // Dedicated Redis connections, not core/redis.ts's singleton or BullMQ's
  // queueConnection — same reasoning as queueConnection.ts's own comment:
  // the adapter permanently puts one of its two connections into
  // subscriber mode, which is incompatible with a connection also used for
  // plain commands elsewhere. Wired in from the start (not deferred to a
  // later "hardening" pass) — docs/ARCHITECTURE.md §11 calls this
  // non-negotiable the moment there's more than one API instance, and it's
  // also what lets the worker process's emitter (emitter.ts) reach browser
  // clients connected to this server at all.
  const pubClient = new Redis(env.REDIS_URL, { lazyConnect: true });
  const subClient = pubClient.duplicate();
  pubClient.on('error', (error) => logger.error({ err: error }, 'Socket.io Redis pub client error'));
  subClient.on('error', (error) => logger.error({ err: error }, 'Socket.io Redis sub client error'));
  io.adapter(createAdapter(pubClient, subClient));

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    resolveAuthenticatedContext(token, tokenRevocationStore)
      .then((context) => {
        socket.data.organizationId = context.organizationId;
        socket.data.userId = context.userId;
        next();
      })
      .catch((error: unknown) => {
        next(error instanceof Error ? error : new Error('Unauthorized'));
      });
  });

  io.on('connection', (socket) => {
    const organizationId = socket.data.organizationId as string;
    void socket.join(organizationRoom(organizationId));
  });

  return {
    io,
    async close() {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      pubClient.disconnect();
      subClient.disconnect();
    },
  };
}
