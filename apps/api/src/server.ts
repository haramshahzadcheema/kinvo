import { createApp } from './app';
import { env } from './config/env';
import { createContainer } from './core/container';
import { logger } from './core/logger';
import { disconnectPrisma } from './core/prisma';
import { redis } from './core/redis';

const container = createContainer();
const app = createApp(container);

const server = app.listen(env.PORT, () => {
  logger.info(`Kinvo API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down gracefully.`);
  server.close(() => {
    void disconnectPrisma().finally(() => {
      redis.disconnect();
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
