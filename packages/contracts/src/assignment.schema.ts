import { z } from 'zod';
import { paginationQuerySchema, sortOrderSchema } from './pagination.schema';

// PENDING -> CONFIRMED | REJECTED | EXPIRED | WITHDRAWN (all terminal)
// CONFIRMED -> CANCELLED | NO_SHOW | COMPLETED (all terminal)
// Enforced in assignments.service.ts, not just here — this schema only
// constrains which values are well-formed. See docs/ARCHITECTURE.md's
// Phase 3 Decisions log for the full state machine and who may trigger
// each transition.
export const assignmentStatusSchema = z.enum([
  'PENDING',
  'CONFIRMED',
  'REJECTED',
  'EXPIRED',
  'WITHDRAWN',
  'CANCELLED',
  'NO_SHOW',
  'COMPLETED',
]);
export type AssignmentStatusValue = z.infer<typeof assignmentStatusSchema>;

// SYSTEM_ERROR is reserved for Phase 4 (CALL-E) — no Phase 3 call site
// produces it, but validating it now means no contract change is needed
// when a webhook handler starts emitting it.
export const attemptOutcomeSchema = z.enum([
  'NO_ANSWER',
  'BUSY',
  'UNREACHABLE',
  'WRONG_NUMBER',
  'REJECTED',
  'CONFIRMED',
  'SYSTEM_ERROR',
]);
export type AttemptOutcomeValue = z.infer<typeof attemptOutcomeSchema>;

export const assignmentAttemptSchema = z.object({
  id: z.string(),
  outcome: attemptOutcomeSchema,
  notes: z.string().nullable(),
  attemptedAt: z.string().datetime(),
  // Which automated voice provider produced this attempt — null for every
  // human-recorded attempt. Without this, the frontend has no way to tell
  // a dispatcher's own manual contact attempt apart from an automated
  // CALL-E call, even though the backend has tracked the distinction since
  // Phase 4 (AssignmentAttempt.provider) — the DTO just never surfaced it.
  provider: z.string().nullable(),
});
export type AssignmentAttemptDto = z.infer<typeof assignmentAttemptSchema>;

// Surfaces a call that's currently in flight (VoiceCallPlacement with no
// resolvedAt yet) — without this, a dispatcher who triggers an automated
// call sees no change at all until (if ever) it resolves, and could easily
// re-trigger it thinking nothing happened. Also doubles as the one piece of
// operational visibility a support engineer gets from the API itself
// (`placedAt` answers "how long has this been ringing?") without needing
// direct database access.
export const pendingVoiceCallSchema = z.object({
  provider: z.string(),
  placedAt: z.string().datetime(),
});
export type PendingVoiceCallDto = z.infer<typeof pendingVoiceCallSchema>;

// SYSTEM_ERROR describes an automated call platform's own failure — only
// Phase 4's CALL-E webhook (not yet built) has a legitimate reason to
// report it. A human dispatcher logging a manual contact attempt through
// this endpoint was never unable to reach their own phone system, so this
// endpoint's request schema excludes the value outright rather than
// relying on the frontend UI simply not offering it as a choice (which it
// already didn't — apps/web's LOGGABLE_ATTEMPT_OUTCOMES — but a UI
// omission is not enforcement; a direct or scripted request could still
// set it). `attemptOutcomeSchema` above stays unrestricted: it also
// validates the response DTO, which must be able to represent a
// SYSTEM_ERROR outcome once CALL-E starts writing them.
export const humanLoggableAttemptOutcomeSchema = attemptOutcomeSchema.exclude(['SYSTEM_ERROR']);
export type HumanLoggableAttemptOutcomeValue = z.infer<typeof humanLoggableAttemptOutcomeSchema>;

export const logAttemptRequestSchema = z.object({
  outcome: humanLoggableAttemptOutcomeSchema,
  notes: z.string().optional(),
});
export type LogAttemptRequest = z.infer<typeof logAttemptRequestSchema>;

// driverName/driverPhone/shipName/destination/truckType/rate/rateCurrency
// are denormalized onto the DTO — same reasoning as
// DriverDto.currentShipName since Phase 2: the cross-ship "call list" and
// per-driver history views need this context and must never require a
// second round trip per row to get it. rate/rateCurrency are the truck
// requirement's own posted rate (not the same field as agreedRate below)
// — needed so a view that only has the Assignment, not the parent
// TruckRequirement, can still show what's being offered when agreedRate
// is null ("use the posted rate").
export const assignmentSchema = z.object({
  id: z.string(),
  truckRequirementId: z.string(),
  driverId: z.string(),
  driverName: z.string(),
  driverPhone: z.string(),
  shipId: z.string(),
  shipName: z.string(),
  destination: z.string(),
  truckType: z.string(),
  rate: z.number().nullable(),
  rateCurrency: z.string().nullable(),
  status: assignmentStatusSchema,
  agreedRate: z.number().nullable(),
  invitedAt: z.string().datetime(),
  respondedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  cancellationReason: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  noShowAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  notes: z.string().nullable(),
  attempts: z.array(assignmentAttemptSchema),
  pendingVoiceCall: pendingVoiceCallSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AssignmentDto = z.infer<typeof assignmentSchema>;

export const createAssignmentRequestSchema = z.object({
  truckRequirementId: z.string().min(1),
  driverId: z.string().min(1),
  // No agreedCurrency field, deliberately — currency belongs to the
  // TruckRequirement's commercial contract, never to an individual
  // driver's negotiation within it. Null means "use the requirement's
  // posted rate."
  agreedRate: z.number().positive().optional(),
});
export type CreateAssignmentRequest = z.infer<typeof createAssignmentRequestSchema>;

export const rejectAssignmentRequestSchema = z.object({
  reason: z.string().optional(),
});
export type RejectAssignmentRequest = z.infer<typeof rejectAssignmentRequestSchema>;

// Cancellation reason is the one mandatory field in this whole feature —
// CONFIRMED -> CANCELLED always has a real-world cause worth capturing,
// unlike an initial PENDING -> REJECTED which may just be "no."
export const cancelAssignmentRequestSchema = z.object({
  reason: z.string().min(1),
});
export type CancelAssignmentRequest = z.infer<typeof cancelAssignmentRequestSchema>;

export const assignmentListQuerySchema = paginationQuerySchema.extend({
  truckRequirementId: z.string().optional(),
  driverId: z.string().optional(),
  status: assignmentStatusSchema.optional(),
  sortBy: z.enum(['invitedAt', 'createdAt']).default('invitedAt'),
  sortOrder: sortOrderSchema.default('asc'),
});
export type AssignmentListQuery = z.infer<typeof assignmentListQuerySchema>;

export const assignmentListResponseSchema = z.object({
  items: z.array(assignmentSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type AssignmentListResponse = z.infer<typeof assignmentListResponseSchema>;
