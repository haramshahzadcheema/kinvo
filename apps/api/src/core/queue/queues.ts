import { Queue } from 'bullmq';
import { queueConnection } from './queueConnection';

export const VOICE_CALLS_QUEUE_NAME = 'voice-calls';
export const VOICE_WEBHOOK_EVENTS_QUEUE_NAME = 'voice-webhook-events';
export const VOICE_RECONCILIATION_QUEUE_NAME = 'voice-reconciliation';
// A fixed, stable id for the one recurring sweep job — upsertJobScheduler
// keyed by this id is idempotent, so every worker process calling it on
// startup (including after a restart) converges on exactly one scheduled
// series rather than creating a duplicate one per process/restart.
export const VOICE_RECONCILIATION_JOB_SCHEDULER_ID = 'voice-reconciliation-sweep';

export interface PlaceVoiceCallJobData {
  assignmentId: string;
  organizationId: string;
  callAttemptRef: string;
}

export interface ProcessVoiceWebhookJobData {
  provider: string;
  eventId: string;
  externalCallId: string;
}

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5000 },
  // Bounded retention, not unlimited — an unbounded completed/failed job
  // history is exactly the kind of thing that looks fine at 10 calls/day
  // and becomes a real Redis memory problem at 10,000/day (see the systems
  // analysis's scaling section). A completed job is fully captured by the
  // AssignmentAttempt/audit log it produced; the queue doesn't need to be
  // the durable record of it too.
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

export const voiceCallsQueue = new Queue<PlaceVoiceCallJobData>(VOICE_CALLS_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions,
});

export const voiceWebhookEventsQueue = new Queue<ProcessVoiceWebhookJobData>(
  VOICE_WEBHOOK_EVENTS_QUEUE_NAME,
  {
    connection: queueConnection,
    defaultJobOptions,
  },
);

// No custom defaultJobOptions — the sweep job carries no per-run data worth
// retrying with backoff (reconcileStaleAttempts already logs-and-continues
// past a single placement's failure, see voice.service.ts) and its own
// short retention is fine at the library default.
export const voiceReconciliationQueue = new Queue(VOICE_RECONCILIATION_QUEUE_NAME, {
  connection: queueConnection,
});

/**
 * Job id = callAttemptRef (see voice.service.ts's placeCallForAssignment
 * for how that's derived). Placing a call for the same round twice (a
 * retried HTTP handler, a duplicate enqueue) is a safe no-op at the queue
 * layer — BullMQ silently ignores adding a job whose id already exists — a
 * second, independent layer of dedup on top of CallEAdapter's own
 * idempotency key, so a duplicate enqueue never even reaches CALL-E.
 */
export function placeVoiceCallJobId(callAttemptRef: string): string {
  return `place-call:${callAttemptRef}`;
}

/**
 * Job id = the provider's own webhook event id — the same idempotency
 * mechanism VoiceWebhookEvent's primary key enforces at the database layer,
 * applied one layer earlier so a duplicate webhook delivery never even
 * enqueues a second job.
 */
export function voiceWebhookEventJobId(provider: string, eventId: string): string {
  return `webhook-event:${provider}:${eventId}`;
}
