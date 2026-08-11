import type { Call } from '@call-e/calle';
import { confirmationStructuredResultSchema } from './confirmationResultSchema';
import type { CallTranscript, VoiceCallOutcome } from './VoiceProvider';

// CallRecipient/CallAttempt/CallTranscriptTurn aren't all in @call-e/calle's
// public export list (only Call/CallRecipient/CreateCallInput/EventList/
// JsonObject are — see its index.d.ts) even though they're real,
// documented fields reachable off Call — accessed via indexed access
// below instead of a named CallAttempt import.

/**
 * The single place that owns the mapping from CALL-E's verified state
 * machine (CallStatus: queued|in_progress|completed|failed|canceled;
 * RecipientStatus: pending|in_progress|completed|failed|skipped — confirmed
 * against the SDK's own OpenAPI schema, not assumed from docs, see
 * CALL-E_Systems_Analysis.md) to Kinvo's VoiceCallOutcome. Everything above
 * this function — CallEAdapter, the voice module, assignments.service —
 * works only in Kinvo's own vocabulary.
 *
 * Total and defensive by construction: every branch resolves to a
 * VoiceCallOutcome rather than throwing, including statuses CALL-E hasn't
 * documented. A surprising provider response becomes a `system_error`
 * outcome to record and investigate, never a crashed worker.
 *
 * The outer try/catch is the actual enforcement of that guarantee — the
 * SDK's declared `Call` type is a compile-time promise, not a runtime one.
 * A field that's missing/wrong-shaped on an actual response (a genuinely
 * malformed payload, a future CALL-E schema change the SDK types haven't
 * caught up with yet) would otherwise throw a raw TypeError out of
 * `translateCompletedCall`'s property access. Left uncaught, that surfaces
 * two different ways depending on the caller — reconcileStaleAttempts
 * catches it per-placement and logs, but the same malformed response never
 * stops recurring, so it logs identically forever without ever resolving;
 * processWebhookSignal has no such catch, so it becomes a BullMQ job
 * failure retried with backoff and eventually dead-lettered, silently,
 * since retrying doesn't fix a response shape that isn't going to change.
 * Converting it into a terminal `system_error` here instead makes it a
 * normal, once-recorded outcome — exactly the reaction to "provider
 * response is malformed" that this function's own doc comment already
 * promises for known-but-unrecognized status values.
 */
export function translateCallToOutcome(call: Call): VoiceCallOutcome {
  try {
    return translateCallToOutcomeUnsafe(call);
  } catch (error) {
    return {
      kind: 'system_error',
      reason: `Could not interpret CALL-E's response for this call: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function translateCallToOutcomeUnsafe(call: Call): VoiceCallOutcome {
  switch (call.status) {
    case 'queued':
    case 'in_progress':
      return { kind: 'pending' };
    case 'failed':
      return {
        kind: 'system_error',
        reason: call.failureMessage ?? call.failureCode ?? 'CALL-E reported the call as failed.',
      };
    case 'canceled':
      // No webhook event exists for `canceled` (verified — see the systems
      // analysis's state-machine section) — this branch is only ever
      // reached via reconciliation polling, never a webhook delivery.
      return { kind: 'system_error', reason: 'Call was canceled before completion.' };
    case 'completed':
      return translateCompletedCall(call);
    default:
      return {
        kind: 'system_error',
        reason: `Unrecognized CALL-E call status: ${String(call.status)}`,
      };
  }
}

// CALL-E's own retry attempts within one recipient (CallAttempt[], plural)
// are a different concept from Kinvo's own AssignmentAttempt (one row per
// outreach round) — the LAST CallAttempt is the one whose status actually
// determined the recipient's final state, so its transcript is the one
// that reflects what happened, not an earlier retry's partial content.
// Returns null (not an empty transcript) when there's genuinely nothing —
// e.g. a number that never connected — since "no transcript exists" is a
// real, honest outcome CALL-E itself reports, not a bug in this
// extraction.
function extractTranscript(recipient: Call['recipients'][number]): CallTranscript | null {
  const attempt = recipient.attempts[recipient.attempts.length - 1];
  if (!attempt) {
    return null;
  }
  if (!attempt.summary && attempt.transcriptTurns.length === 0) {
    return null;
  }
  return {
    summary: attempt.summary,
    turns: attempt.transcriptTurns.map((turn) => ({
      speaker: turn.speaker,
      text: turn.text,
      // Genuinely snake_case at runtime, not a stale type — see calls.js's
      // `transcriptTurns: attempt.transcript_turns ?? []`, which aliases
      // the array itself to camelCase but never touches the turn objects
      // inside it.
      offsetSeconds: turn.offset_seconds,
    })),
  };
}

function translateCompletedCall(call: Call): VoiceCallOutcome {
  // Kinvo always places single-recipient calls — see CallEAdapter — so the
  // first recipient is the only one that can exist.
  const recipient = call.recipients[0];
  if (!recipient) {
    return { kind: 'system_error', reason: 'Completed call has no recipients.' };
  }

  if (recipient.status === 'failed' || recipient.status === 'skipped') {
    return { kind: 'unreachable', transcript: extractTranscript(recipient) };
  }

  if (recipient.status !== 'completed') {
    return {
      kind: 'system_error',
      reason: `Completed call has recipient in unexpected status: ${recipient.status}`,
    };
  }

  if (call.taskCompleted === false) {
    return {
      kind: 'ambiguous',
      reason: 'CALL-E did not judge the task as completed.',
      transcript: extractTranscript(recipient),
    };
  }

  // Prefer the recipient-level result (populated when a
  // recipientResultSchema is used) and fall back to the call-level result —
  // Kinvo only ever sets the task-level resultSchema today, so the
  // call-level field is the path actually exercised; the recipient-level
  // check is forward-compatible defense, not dead code.
  const parsed = confirmationStructuredResultSchema.safeParse(
    recipient.structuredResult ?? call.structuredResult,
  );

  if (!parsed.success) {
    return {
      kind: 'ambiguous',
      reason: 'Structured result missing or did not match the expected confirmation schema.',
      transcript: extractTranscript(recipient),
    };
  }

  const transcript = extractTranscript(recipient);
  switch (parsed.data.confirmed) {
    case 'yes':
      return { kind: 'confirmed', transcript };
    case 'no':
      return { kind: 'declined', transcript };
    case 'unclear':
      return { kind: 'ambiguous', reason: 'Driver response was classified as unclear.', transcript };
  }
}
