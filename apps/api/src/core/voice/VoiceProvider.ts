/**
 * Kinvo's own vocabulary for an automated confirmation call, deliberately
 * independent of any one voice platform's concepts (CALL-E's Calls vs Goal
 * Runs, recipients, attempts, structured_result, ...). CALL-E is the first
 * implementation of this interface, not the only one it was designed for —
 * see docs/ARCHITECTURE.md's Phase 4 Decisions log.
 *
 * `pending` is not a real AssignmentAttempt outcome — it means "CALL-E has
 * not reached a terminal state for this call yet." Kinvo's webhook only
 * ever fires for terminal states, so callers driven by a webhook should
 * never see it in practice. The reconciliation path (voice.service.ts's
 * reconcileStaleAttempts) is the one place that legitimately can: a call
 * still `pending` well past a reasonable timeout is Kinvo's own decision to
 * treat as a system error, not something this provider layer should decide
 * on its own — collapsing `pending` into `system_error` here would silently
 * mis-record a call that is simply still ringing.
 */
export type VoiceCallOutcome =
  | { kind: 'confirmed' }
  | { kind: 'declined' }
  | { kind: 'unreachable' }
  | { kind: 'ambiguous'; reason: string }
  | { kind: 'system_error'; reason: string }
  | { kind: 'pending' };

export interface RequestConfirmationCallInput {
  phone: string;
  driverName: string;
  shipName: string;
  destination: string;
  truckType: string;
  rate: number | null;
  rateCurrency: string | null;
  /**
   * Kinvo-owned identifiers, passed through purely for provider-side
   * observability/support (e.g. looking a call up in CALL-E's own
   * dashboard) — never read back by Kinvo itself. The authoritative
   * assignmentId <-> externalCallId mapping lives in Kinvo's own
   * VoiceCallPlacement table (see voice.service.ts), not in a round-trip
   * through the provider's metadata echo, so a provider that drops,
   * truncates, or never echoes metadata back doesn't break anything.
   * `callAttemptRef` is what actually drives the idempotency key — see
   * CallEAdapter.
   */
  metadata: {
    assignmentId: string;
    organizationId: string;
    callAttemptRef: string;
  };
}

export interface VoiceCallHandle {
  provider: string;
  externalCallId: string;
}

/**
 * The result of parsing an inbound webhook delivery. Deliberately carries
 * almost nothing: every provider's webhook deliveries are treated as an
 * untrusted signal that "something happened to this call," never as a
 * source of truth for the call's actual state. The only two facts a caller
 * needs are which call to re-fetch authoritatively (`externalCallId`) and a
 * stable id to dedupe the delivery itself (`eventId`) — see
 * VoiceWebhookEvent in schema.prisma.
 */
export type WebhookSignal =
  | { kind: 'call_event'; provider: string; eventId: string; externalCallId: string }
  | { kind: 'unrecognized' };

export interface VoiceProvider {
  readonly name: string;
  requestConfirmationCall(input: RequestConfirmationCallInput): Promise<VoiceCallHandle>;
  /**
   * Fetches the call's current, authoritative state directly from the
   * provider (never from a webhook body) and translates it into Kinvo's
   * outcome vocabulary. Implementations must let transient/transport errors
   * (timeouts, 5xx, rate limits) propagate rather than swallowing them into
   * a `system_error` outcome — a failed *attempt to check* is not the same
   * fact as CALL-E telling us the call itself failed, and only the latter
   * belongs in a permanent AssignmentAttempt record. The caller's queue
   * retry/backoff policy is what should handle the former.
   */
  getCallOutcome(externalCallId: string): Promise<VoiceCallOutcome>;
  parseWebhookSignal(rawBody: unknown): WebhookSignal;
}
