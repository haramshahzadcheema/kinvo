import { Worker } from 'bullmq';
import type { Logger } from 'pino';
import { env } from '../../config/env';
import { queueConnection } from '../../core/queue/queueConnection';
import {
  VOICE_CALLS_QUEUE_NAME,
  VOICE_RECONCILIATION_QUEUE_NAME,
  VOICE_WEBHOOK_EVENTS_QUEUE_NAME,
  type PlaceVoiceCallJobData,
  type ProcessVoiceWebhookJobData,
} from '../../core/queue/queues';
import type { VoiceService } from './voice.service';

export interface VoiceWorkers {
  callsWorker: Worker<PlaceVoiceCallJobData>;
  webhooksWorker: Worker<ProcessVoiceWebhookJobData>;
  reconciliationWorker: Worker;
  close(): Promise<void>;
}

/**
 * Registers the three BullMQ Workers that actually run voice.service.ts's
 * logic. Concurrency is configurable per queue (VOICE_CALLS_CONCURRENCY,
 * VOICE_WEBHOOK_CONCURRENCY) — deliberately conservative defaults (see
 * .env.example) since CALL-E's own rate limits are external and unverified
 * at any specific number; better to under-parallelize now and raise it once
 * real production volume and CALL-E's actual limits are both known than to
 * guess high and get rate-limited.
 *
 * No retry/backoff logic lives here — that's entirely BullMQ's job
 * (defaultJobOptions in queues.ts) plus voice.service.ts's own
 * error-propagation contract (see VoiceProvider.getCallOutcome's doc
 * comment): a thrown error here means "retry this job," full stop.
 */
export function createVoiceWorkers(voiceService: VoiceService, logger: Logger): VoiceWorkers {
  const callsWorker = new Worker<PlaceVoiceCallJobData>(
    VOICE_CALLS_QUEUE_NAME,
    (job) => voiceService.executeCallPlacement(job.data),
    { connection: queueConnection, concurrency: env.VOICE_CALLS_CONCURRENCY },
  );

  const webhooksWorker = new Worker<ProcessVoiceWebhookJobData>(
    VOICE_WEBHOOK_EVENTS_QUEUE_NAME,
    (job) => voiceService.processWebhookSignal(job.data),
    { connection: queueConnection, concurrency: env.VOICE_WEBHOOK_CONCURRENCY },
  );

  // Concurrency 1: this queue only ever has the one recurring sweep job in
  // flight at a time by design (see queueConnection's job scheduler in
  // worker.ts) — reconcileStaleAttempts already processes its whole batch
  // of stale placements internally, sequentially, logging past individual
  // failures rather than throwing per-placement.
  const reconciliationWorker = new Worker(
    VOICE_RECONCILIATION_QUEUE_NAME,
    () => voiceService.reconcileStaleAttempts(),
    { connection: queueConnection, concurrency: 1 },
  );

  for (const worker of [callsWorker, webhooksWorker, reconciliationWorker]) {
    // No swallowed exceptions, no mystery states: every job failure (after
    // BullMQ's own retries are exhausted, or on its way to one) is a
    // structured log line naming the queue, job id, and error — not a
    // silently-dropped promise rejection.
    worker.on('failed', (job, error) => {
      logger.error(
        { err: error, queue: worker.name, jobId: job?.id, attemptsMade: job?.attemptsMade },
        'Voice worker job failed',
      );
    });
    worker.on('error', (error) => {
      logger.error({ err: error, queue: worker.name }, 'Voice worker connection error');
    });
  }

  return {
    callsWorker,
    webhooksWorker,
    reconciliationWorker,
    async close(): Promise<void> {
      await Promise.all([callsWorker.close(), webhooksWorker.close(), reconciliationWorker.close()]);
    },
  };
}
