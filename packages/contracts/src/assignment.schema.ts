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
});
export type AssignmentAttemptDto = z.infer<typeof assignmentAttemptSchema>;

export const logAttemptRequestSchema = z.object({
  outcome: attemptOutcomeSchema,
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
