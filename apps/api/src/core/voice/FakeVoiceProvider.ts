import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  RequestConfirmationCallInput,
  VoiceCallHandle,
  VoiceCallOutcome,
  VoiceProvider,
  WebhookSignal,
} from './VoiceProvider';

interface FakeCallRecord {
  externalCallId: string;
  input: RequestConfirmationCallInput;
  outcome: VoiceCallOutcome;
}

const fakeWebhookBodySchema = z.object({
  eventId: z.string().min(1),
  externalCallId: z.string().min(1),
});

/**
 * In-memory VoiceProvider double for tests and local development without a
 * real CALL-E account. Every call starts `pending` (mirroring a real
 * provider's queued/in_progress window) until a test explicitly resolves it
 * via `setOutcome`, so tests exercise the same "not yet terminal" path a
 * real webhook race would hit rather than always seeing an instant result.
 */
export interface FakeVoiceProvider extends VoiceProvider {
  setOutcome(externalCallId: string, outcome: VoiceCallOutcome): void;
  /** Builds a raw webhook body `parseWebhookSignal` will accept for a call already placed via `requestConfirmationCall`. */
  buildWebhookPayload(externalCallId: string): unknown;
  getCallRecord(externalCallId: string): FakeCallRecord | undefined;
}

export function createFakeVoiceProvider(): FakeVoiceProvider {
  const calls = new Map<string, FakeCallRecord>();
  // Mirrors CallEAdapter's own idempotencyKey behavior (keyed off
  // metadata.callAttemptRef) — without this, a test replaying the same
  // placement job (simulating a worker crash-and-retry) would see the fake
  // provider mint a brand new call every time, which would never exercise
  // (and could hide bugs in) executeCallPlacement's actual crash-recovery
  // path, since that path only does anything interesting when a replay
  // returns the SAME externalCallId a real provider would.
  const callAttemptRefToExternalCallId = new Map<string, string>();

  function requireRecord(externalCallId: string): FakeCallRecord {
    const record = calls.get(externalCallId);
    if (!record) {
      throw new Error(`FakeVoiceProvider: no call recorded for id ${externalCallId}`);
    }
    return record;
  }

  return {
    name: 'fake',

    async requestConfirmationCall(input: RequestConfirmationCallInput): Promise<VoiceCallHandle> {
      const existingId = callAttemptRefToExternalCallId.get(input.metadata.callAttemptRef);
      if (existingId) {
        return { provider: 'fake', externalCallId: existingId };
      }

      const externalCallId = `fake_call_${randomUUID()}`;
      calls.set(externalCallId, { externalCallId, input, outcome: { kind: 'pending' } });
      callAttemptRefToExternalCallId.set(input.metadata.callAttemptRef, externalCallId);
      return { provider: 'fake', externalCallId };
    },

    async getCallOutcome(externalCallId: string): Promise<VoiceCallOutcome> {
      return requireRecord(externalCallId).outcome;
    },

    parseWebhookSignal(rawBody: unknown): WebhookSignal {
      const parsed = fakeWebhookBodySchema.safeParse(rawBody);
      if (!parsed.success) {
        return { kind: 'unrecognized' };
      }
      return {
        kind: 'call_event',
        provider: 'fake',
        eventId: parsed.data.eventId,
        externalCallId: parsed.data.externalCallId,
      };
    },

    setOutcome(externalCallId: string, outcome: VoiceCallOutcome): void {
      requireRecord(externalCallId).outcome = outcome;
    },

    buildWebhookPayload(externalCallId: string): unknown {
      requireRecord(externalCallId);
      return { eventId: `fake_evt_${randomUUID()}`, externalCallId };
    },

    getCallRecord(externalCallId: string): FakeCallRecord | undefined {
      return calls.get(externalCallId);
    },
  };
}
