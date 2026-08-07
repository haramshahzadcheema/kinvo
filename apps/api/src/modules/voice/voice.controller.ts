import type { RequestHandler } from 'express';
import { logger } from '../../core/logger';
import { voiceWebhookEventJobId, voiceWebhookEventsQueue } from '../../core/queue/queues';
import type { VoiceProvider } from '../../core/voice/VoiceProvider';
import type { VoiceService } from './voice.service';

export interface VoiceController {
  placeCallForAssignment: RequestHandler;
  receiveCallEWebhook: RequestHandler;
}

export function createVoiceController(
  voiceService: VoiceService,
  voiceProvider: VoiceProvider,
): VoiceController {
  const placeCallForAssignment: RequestHandler = async (req, res, next) => {
    try {
      await voiceService.placeCallForAssignment(req.params.assignmentId as string);
      // 202, not 200/201 — nothing has actually happened to the assignment
      // yet, only a queue job. The eventual state change (or lack of one,
      // if the call fails) shows up as a new AssignmentAttempt once the
      // worker and/or webhook processes it.
      res.status(202).json({ status: 'queued' });
    } catch (error) {
      next(error);
    }
  };

  // Deliberately outside `authenticate`/any tenant context — see
  // voice.routes.ts for why. Every byte of `req.body` is untrusted: CALL-E's
  // webhook deliveries carry no signature (verified — see
  // CALL-E_Systems_Analysis.md). This handler's only job is to extract
  // enough to enqueue a job that re-fetches the truth authoritatively; it
  // never acts on the body's own claims about call state.
  const receiveCallEWebhook: RequestHandler = async (req, res, next) => {
    try {
      const signal = voiceProvider.parseWebhookSignal(req.body);
      if (signal.kind === 'unrecognized') {
        // Acknowledge anyway — CALL-E treats any 2xx as delivered and
        // ignores the response body, so there is no real "reject" outcome
        // to give it here, and nothing about this delivery is retryable by
        // fixing something on Kinvo's side. Body content is deliberately
        // not logged — it's unauthenticated, arbitrary external input.
        logger.warn('Discarding an unrecognized voice webhook delivery.');
        res.status(200).json({ ok: true });
        return;
      }

      await voiceWebhookEventsQueue.add(
        'process-webhook-event',
        {
          provider: signal.provider,
          eventId: signal.eventId,
          externalCallId: signal.externalCallId,
        },
        { jobId: voiceWebhookEventJobId(signal.provider, signal.eventId) },
      );

      res.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  };

  return { placeCallForAssignment, receiveCallEWebhook };
}
