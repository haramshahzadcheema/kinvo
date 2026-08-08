export type YellowZonePriorityValue = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Maps a SYSTEM_ERROR AssignmentAttempt's `notes` (the verbatim reason
 * string outcomeTranslation.ts already produces — see that file and
 * voice.service.ts's applyVoiceOutcome/resolvePlacement) to a Yellow Zone
 * priority. This is a pure, total function classifying text that already
 * exists, not a new source of truth — it never talks to CALL-E, the
 * database, or anything else.
 *
 * The three buckets are severity, not outcome type:
 *  - HIGH: something on the automation side is actually broken (a
 *    malformed/unrecognized provider response, a CALL-E-reported failure,
 *    a completed call with no usable recipient data) — worth a dispatcher's
 *    attention promptly, since it may recur on the next call too.
 *  - MEDIUM: the call completed and a driver did respond, but CALL-E
 *    couldn't classify the answer confidently — routine human judgment,
 *    not urgent.
 *  - LOW: a timing/transport outcome (canceled before completion, or
 *    Kinvo's own reconciliation timeout) — usually resolves itself on a
 *    retry, lowest urgency of the three.
 *
 * `reason: null` and any reason string that doesn't match a known pattern
 * both fall to MEDIUM — the safe, non-committal default when there isn't
 * enough information to judge severity either way. This function must
 * never throw; an unrecognized reason is a classification gap to log and
 * improve, not a reason to lose the escalation itself.
 */
export function classifyEscalation(reason: string | null): YellowZonePriorityValue {
  if (!reason) {
    return 'MEDIUM';
  }

  if (
    reason.includes('CALL-E reported the call as failed') ||
    reason.startsWith('Unrecognized CALL-E call status') ||
    reason.includes('Completed call has no recipients') ||
    reason.includes('Completed call has recipient in unexpected status') ||
    reason.startsWith("Could not interpret CALL-E's response")
  ) {
    return 'HIGH';
  }

  if (
    reason.includes('did not judge the task as completed') ||
    reason.includes('Structured result missing or did not match') ||
    reason.includes('classified as unclear')
  ) {
    return 'MEDIUM';
  }

  if (
    reason.includes('Call was canceled before completion') ||
    reason.includes('did not reach a terminal state within')
  ) {
    return 'LOW';
  }

  return 'MEDIUM';
}
