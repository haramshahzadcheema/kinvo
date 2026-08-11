import type { Call, CallRecipient } from '@call-e/calle';
import { describe, expect, it } from 'vitest';
import { translateCallToOutcome } from '../../src/core/voice/outcomeTranslation';

function makeRecipient(overrides: Partial<CallRecipient> = {}): CallRecipient {
  return {
    id: 'recipient-1',
    phones: ['+10000000000'],
    locale: null,
    region: null,
    status: 'completed',
    structuredResult: null,
    summary: null,
    attempts: [],
    ...overrides,
  };
}

function makeCall(overrides: Partial<Call> = {}): Call {
  return {
    id: 'call-1',
    object: 'call_task',
    status: 'completed',
    task: 'Call the driver.',
    recipients: [makeRecipient()],
    structuredResult: null,
    summary: null,
    taskCompleted: true,
    completionConfidence: null,
    evidence: [],
    metadata: {},
    failureCode: null,
    failureMessage: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('translateCallToOutcome', () => {
  it('treats queued as pending', () => {
    expect(translateCallToOutcome(makeCall({ status: 'queued' }))).toEqual({ kind: 'pending' });
  });

  it('treats in_progress as pending', () => {
    expect(translateCallToOutcome(makeCall({ status: 'in_progress' }))).toEqual({
      kind: 'pending',
    });
  });

  it('maps failed to system_error, preferring failureMessage over failureCode', () => {
    const outcome = translateCallToOutcome(
      makeCall({ status: 'failed', failureCode: 'provider_outage', failureMessage: 'Down.' }),
    );
    expect(outcome).toEqual({ kind: 'system_error', reason: 'Down.' });
  });

  it('maps failed with no failureMessage to system_error using failureCode', () => {
    const outcome = translateCallToOutcome(
      makeCall({ status: 'failed', failureCode: 'provider_outage', failureMessage: null }),
    );
    expect(outcome).toEqual({ kind: 'system_error', reason: 'provider_outage' });
  });

  it('maps canceled to system_error', () => {
    const outcome = translateCallToOutcome(makeCall({ status: 'canceled' }));
    expect(outcome.kind).toBe('system_error');
  });

  it('maps a completed call with a failed recipient to unreachable', () => {
    const outcome = translateCallToOutcome(
      makeCall({ recipients: [makeRecipient({ status: 'failed' })] }),
    );
    expect(outcome).toEqual({ kind: 'unreachable', transcript: null });
  });

  it('maps a completed call with a skipped recipient to unreachable', () => {
    const outcome = translateCallToOutcome(
      makeCall({ recipients: [makeRecipient({ status: 'skipped' })] }),
    );
    expect(outcome).toEqual({ kind: 'unreachable', transcript: null });
  });

  it('maps a completed call with no recipients to system_error', () => {
    const outcome = translateCallToOutcome(makeCall({ recipients: [] }));
    expect(outcome.kind).toBe('system_error');
  });

  it('maps a completed call whose recipient is still pending/in_progress to system_error', () => {
    const outcome = translateCallToOutcome(
      makeCall({ recipients: [makeRecipient({ status: 'in_progress' })] }),
    );
    expect(outcome.kind).toBe('system_error');
  });

  it('maps taskCompleted: false to ambiguous', () => {
    const outcome = translateCallToOutcome(makeCall({ taskCompleted: false }));
    expect(outcome.kind).toBe('ambiguous');
  });

  it('maps confirmed: "yes" to confirmed', () => {
    const outcome = translateCallToOutcome(makeCall({ structuredResult: { confirmed: 'yes' } }));
    expect(outcome).toEqual({ kind: 'confirmed', transcript: null });
  });

  it('maps confirmed: "no" to declined', () => {
    const outcome = translateCallToOutcome(makeCall({ structuredResult: { confirmed: 'no' } }));
    expect(outcome).toEqual({ kind: 'declined', transcript: null });
  });

  it('maps confirmed: "unclear" to ambiguous', () => {
    const outcome = translateCallToOutcome(
      makeCall({ structuredResult: { confirmed: 'unclear' } }),
    );
    expect(outcome.kind).toBe('ambiguous');
  });

  it('maps a null structuredResult (schema validation failure) to ambiguous', () => {
    const outcome = translateCallToOutcome(makeCall({ structuredResult: null }));
    expect(outcome.kind).toBe('ambiguous');
  });

  it('maps a malformed structuredResult to ambiguous rather than throwing', () => {
    const outcome = translateCallToOutcome(
      makeCall({ structuredResult: { confirmed: 'maybe', extra: true } }),
    );
    expect(outcome.kind).toBe('ambiguous');
  });

  it('prefers the recipient-level structuredResult over the call-level one', () => {
    const outcome = translateCallToOutcome(
      makeCall({
        structuredResult: { confirmed: 'no' },
        recipients: [makeRecipient({ structuredResult: { confirmed: 'yes' } })],
      }),
    );
    expect(outcome).toEqual({ kind: 'confirmed', transcript: null });
  });

  it('falls back to the call-level structuredResult when the recipient has none', () => {
    const outcome = translateCallToOutcome(
      makeCall({
        structuredResult: { confirmed: 'yes' },
        recipients: [makeRecipient({ structuredResult: null })],
      }),
    );
    expect(outcome).toEqual({ kind: 'confirmed', transcript: null });
  });

  it('never throws for an unrecognized status', () => {
    const outcome = translateCallToOutcome(
      makeCall({ status: 'some_future_status' as Call['status'] }),
    );
    expect(outcome.kind).toBe('system_error');
  });

  it('never throws when recipients is missing/malformed, despite the SDK type claiming it always exists', () => {
    const outcome = translateCallToOutcome(
      makeCall({ recipients: undefined as unknown as Call['recipients'] }),
    );
    expect(outcome.kind).toBe('system_error');
  });

  it('never throws when a recipient entry itself is malformed', () => {
    const outcome = translateCallToOutcome(
      makeCall({ recipients: [null as unknown as CallRecipient] }),
    );
    expect(outcome.kind).toBe('system_error');
  });
});

describe('translateCallToOutcome — transcript extraction', () => {
  it('attaches a real transcript from the last CallAttempt, converting offset_seconds (snake_case, straight off the raw API) to offsetSeconds', () => {
    const outcome = translateCallToOutcome(
      makeCall({
        structuredResult: { confirmed: 'yes' },
        recipients: [
          makeRecipient({
            attempts: [
              {
                id: 'attempt-1',
                phone: '+10000000000',
                status: 'failed',
                startedAt: null,
                completedAt: null,
                summary: 'Earlier failed attempt — should be ignored.',
                transcriptTurns: [],
                providerCallId: null,
                failureCode: null,
                failureMessage: null,
              },
              {
                id: 'attempt-2',
                phone: '+10000000000',
                status: 'completed',
                startedAt: null,
                completedAt: null,
                summary: 'Driver confirmed the job.',
                transcriptTurns: [
                  { offset_seconds: 0, speaker: 'bot', text: 'Can you take this job?' },
                  { offset_seconds: 3.5, speaker: 'user', text: 'Yes, I can.' },
                ],
                providerCallId: 'provider-call-1',
                failureCode: null,
                failureMessage: null,
              },
            ],
          }),
        ],
      }),
    );

    expect(outcome).toEqual({
      kind: 'confirmed',
      transcript: {
        summary: 'Driver confirmed the job.',
        turns: [
          { speaker: 'bot', text: 'Can you take this job?', offsetSeconds: 0 },
          { speaker: 'user', text: 'Yes, I can.', offsetSeconds: 3.5 },
        ],
      },
    });
  });

  it('has no transcript when the last attempt carries neither a summary nor any turns', () => {
    const outcome = translateCallToOutcome(
      makeCall({
        structuredResult: { confirmed: 'yes' },
        recipients: [
          makeRecipient({
            attempts: [
              {
                id: 'attempt-1',
                phone: '+10000000000',
                status: 'completed',
                startedAt: null,
                completedAt: null,
                summary: null,
                transcriptTurns: [],
                providerCallId: null,
                failureCode: null,
                failureMessage: null,
              },
            ],
          }),
        ],
      }),
    );

    expect(outcome).toEqual({ kind: 'confirmed', transcript: null });
  });
});
