import { createApp } from './app';
import { env } from './config/env';
import { createContainer } from './core/container';
import { logger } from './core/logger';
import { disconnectPrisma } from './core/prisma';
import { emitterRedisClient } from './core/realtime/emitter';
import { createRealtimeServer } from './core/realtime/socketServer';
import { redis } from './core/redis';

const container = createContainer();
const app = createApp(container);

const server = app.listen(env.PORT, () => {
  logger.info(`Kinvo API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

// Attached after the HTTP server exists (Socket.io needs a real
// http.Server to piggyback its own upgrade handling on) — see
// core/realtime/socketServer.ts's own comment for why this is a separate
// construction step from createContainer(), not folded into it.
const realtimeServer = createRealtimeServer(server, container.tokenRevocationStore);

function shutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down gracefully.`);
  void realtimeServer.close().finally(() => {
    server.close(() => {
      void disconnectPrisma().finally(() => {
        redis.disconnect();
        emitterRedisClient.disconnect();
        process.exit(0);
      });
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
