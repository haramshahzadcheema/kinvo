import { env } from './config/env';
import { createContainer } from './core/container';
import { logger } from './core/logger';
import { disconnectPrisma } from './core/prisma';
import { queueConnection } from './core/queue/queueConnection';
import {
  VOICE_RECONCILIATION_JOB_SCHEDULER_ID,
  voiceReconciliationQueue,
} from './core/queue/queues';
import { redis } from './core/redis';
import { createVoiceWorkers } from './modules/voice/voice.workers';

/**
 * A second entrypoint into the same `apps/api` package, not a separate
 * monorepo package — see docs/ARCHITECTURE.md's Phase 4 Decisions log.
 * Extracting shared core code (Prisma client, container, config) into its
 * own package to support a genuinely separate `apps/worker` would be a much
 * larger, riskier restructuring than Phase 4's actual requirement — a
 * worker process — needs. Deployed as a second container from the same
 * image, running `node dist/worker.js` instead of `dist/server.js` (see
 * docker-compose.yml), which already satisfies "workers run as a separate
 * process from day one," the principle this was written against.
 */
async function main(): Promise<void> {
  const container = createContainer();

  // Idempotent — every worker process (including this one after a restart)
  // upserts the same fixed scheduler id, so this never creates more than
  // one recurring series no matter how many worker replicas run this on
  // startup.
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
    'Kinvo voice worker process started.',
  );

  function shutdown(signal: string): void {
    logger.info(`Received ${signal}, shutting down gracefully.`);
    void workers
      .close()
      .then(() => queueConnection.quit())
      .then(() => disconnectPrisma())
      .finally(() => {
        redis.disconnect();
        process.exit(0);
      });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error({ err: error }, 'Kinvo voice worker process failed to start.');
  process.exit(1);
});
