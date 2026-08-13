import { createApp } from './app';
import { env } from './config/env';
import { createContainer } from './core/container';
import { logger } from './core/logger';
import { disconnectPrisma } from './core/prisma';
import { queueConnection } from './core/queue/queueConnection';
import { VOICE_RECONCILIATION_JOB_SCHEDULER_ID, voiceReconciliationQueue } from './core/queue/queues';
import { emitterRedisClient } from './core/realtime/emitter';
import { createRealtimeServer } from './core/realtime/socketServer';
import { redis } from './core/redis';
import { createVoiceWorkers } from './modules/voice/voice.workers';

/**
 * A third entrypoint, alongside server.ts and worker.ts — not a
 * replacement for either. docker-compose (and any deploy with room for a
 * genuinely separate worker process/service) still runs those two apart,
 * exactly as docs/ARCHITECTURE.md's §16 and worker.ts's own doc comment
 * describe: independent scaling, a stuck webhook handler can't starve HTTP
 * request handling.
 *
 * This exists for hosts whose free tier only grants one persistent
 * process (e.g. Render's free web service) — separate api/worker services
 * would mean the worker either doesn't run at all (Render's free tier has
 * no free background-worker product) or costs money. Both halves share
 * the ONE `createContainer()` call below rather than each constructing
 * their own, so this never ends up wiring two independent copies of the
 * same services against the same (already-singleton, per core/prisma.ts
 * and core/redis.ts) Prisma/Redis clients.
 */
async function main(): Promise<void> {
  const container = createContainer();
  const app = createApp(container);

  const server = app.listen(env.PORT, () => {
    logger.info(`Kinvo API (standalone, api+worker combined) listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  const realtimeServer = createRealtimeServer(server, container.tokenRevocationStore);

  await voiceReconciliationQueue.upsertJobScheduler(VOICE_RECONCILIATION_JOB_SCHEDULER_ID, {
    every: env.VOICE_RECONCILE_INTERVAL_MINUTES * 60_000,
  });

  const workers = createVoiceWorkers(container.voiceService, logger);
  logger.info(
    {
      callsConcurrency: env.VOICE_CALLS_CONCURRENCY,
      webhookConcurrency: env.VOICE_WEBHOOK_CONCURRENCY,
      reconcileIntervalMinutes: env.VOICE_RECONCILE_INTERVAL_MINUTES,
    },
    'Kinvo voice worker started (standalone process).',
  );

  function shutdown(signal: string): void {
    logger.info(`Received ${signal}, shutting down gracefully.`);
    void workers
      .close()
      .then(() => realtimeServer.close())
      .then(() => new Promise<void>((resolve) => server.close(() => resolve())))
      .then(() => queueConnection.quit())
      .then(() => disconnectPrisma())
      .finally(() => {
        redis.disconnect();
        emitterRedisClient.disconnect();
        process.exit(0);
      });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error({ err: error }, 'Kinvo standalone process failed to start.');
  process.exit(1);
});
