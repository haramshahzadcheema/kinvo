import { createApp } from './app';
import { env } from './config/env';
import { pool } from './core/database';
import { logger } from './core/logger';
import { redis } from './core/redis';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Kinvo API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down gracefully.`);
  server.close(() => {
    void pool.end().finally(() => {
      redis.disconnect();
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
