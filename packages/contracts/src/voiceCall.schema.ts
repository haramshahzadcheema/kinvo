import { z } from 'zod';
import { attemptOutcomeSchema } from './assignment.schema';
import { paginationQuerySchema } from './pagination.schema';

// Phase E (Intelligence — Transcripts): real conversation content from
// CALL-E's own API (`recipients[].attempts[].transcriptTurns`/`.summary`
// via CalleCalls.get(callId)) — see
// core/voice/outcomeTranslation.ts's extractTranscript for how this gets
// derived, and AssignmentAttempt.transcriptTurns in schema.prisma for
// where it's persisted. Empty array (not null/absent) when a resolved
// call genuinely has no transcript — e.g. a number that never connected —
// so the frontend can render "no turns" with a plain `.length === 0`
// check rather than a separate null branch.
export const transcriptTurnSchema = z.object({
  speaker: z.enum(['bot', 'user', 'unknown']),
  text: z.string(),
  offsetSeconds: z.number().nullable(),
});
export type TranscriptTurnDto = z.infer<typeof transcriptTurnSchema>;

// A resolved automated call — backed 1:1 by an AssignmentAttempt with
// provider set (see assignments.service.ts's AttemptActor). Reuses
// attemptOutcomeSchema/its labels rather than inventing separate
// "call status" terminology: a dispatcher already knows what CONFIRMED,
// REJECTED, UNREACHABLE, and SYSTEM_ERROR mean from the Assignments screen,
// and a call that reached SYSTEM_ERROR for an "ambiguous" reason (CALL-E
// couldn't classify the driver's answer) is still SYSTEM_ERROR here — the
// real reason is never lost, it's in `notes` verbatim (see
// outcomeTranslation.ts and voice.service.ts's applyVoiceOutcome).
export const resolvedVoiceCallSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  driverId: z.string(),
  driverName: z.string(),
  driverPhone: z.string(),
  shipId: z.string(),
  shipName: z.string(),
  destination: z.string(),
  truckType: z.string(),
  provider: z.string(),
  externalCallId: z.string().nullable(),
  outcome: attemptOutcomeSchema,
  notes: z.string().nullable(),
  attemptedAt: z.string().datetime(),
  transcriptSummary: z.string().nullable(),
  transcriptTurns: z.array(transcriptTurnSchema),
});
export type ResolvedVoiceCallDto = z.infer<typeof resolvedVoiceCallSchema>;

export const voiceCallListQuerySchema = paginationQuerySchema.extend({
  outcome: attemptOutcomeSchema.optional(),
});
export type VoiceCallListQuery = z.infer<typeof voiceCallListQuerySchema>;

export const voiceCallListResponseSchema = z.object({
  items: z.array(resolvedVoiceCallSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type VoiceCallListResponse = z.infer<typeof voiceCallListResponseSchema>;

// A call still in flight — backed by an unresolved VoiceCallPlacement, with
// no AssignmentAttempt yet (see schema.prisma's VoiceCallPlacement comment
// for why the two are never written atomically). Deliberately unpaginated
// but capped (see listActiveCalls) — in practice bounded by
// VOICE_CALLS_CONCURRENCY, never a large list.
export const activeVoiceCallSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  driverId: z.string(),
  driverName: z.string(),
  driverPhone: z.string(),
  shipId: z.string(),
  shipName: z.string(),
  destination: z.string(),
  truckType: z.string(),
  provider: z.string(),
  externalCallId: z.string(),
  placedAt: z.string().datetime(),
});
export type ActiveVoiceCallDto = z.infer<typeof activeVoiceCallSchema>;

export const activeVoiceCallsResponseSchema = z.object({
  items: z.array(activeVoiceCallSchema),
});
export type ActiveVoiceCallsResponse = z.infer<typeof activeVoiceCallsResponseSchema>;
