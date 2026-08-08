import { z } from 'zod';
import { assignmentStatusSchema } from './assignment.schema';
import { paginationQuerySchema } from './pagination.schema';

// Phase 5's escalation queue — one row per SYSTEM_ERROR AssignmentAttempt
// a dispatcher needs to review. See voice.service.ts and
// core/yellow-zone/escalationClassification.ts for how these get created;
// deliberately built against unresolved OUTBOUND calls, not a literal
// inbound-call concept CALL-E doesn't support — see
// docs/ARCHITECTURE.md's Phase 5 Decisions log (Option A).
export const yellowZoneStatusSchema = z.enum(['PENDING', 'IN_REVIEW', 'RESOLVED', 'DISMISSED']);
export type YellowZoneStatusValue = z.infer<typeof yellowZoneStatusSchema>;

export const yellowZonePrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type YellowZonePriorityValue = z.infer<typeof yellowZonePrioritySchema>;

export const yellowZoneItemSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  assignmentAttemptId: z.string(),
  driverId: z.string(),
  driverName: z.string(),
  driverPhone: z.string(),
  shipId: z.string(),
  shipName: z.string(),
  destination: z.string(),
  truckType: z.string(),
  reason: z.string(),
  priority: yellowZonePrioritySchema,
  status: yellowZoneStatusSchema,
  // The underlying Assignment's CURRENT status — always PENDING at the
  // moment an escalation is created (SYSTEM_ERROR only ever fires against
  // a still-pending assignment, see voice.service.ts), but not necessarily
  // still PENDING by the time a dispatcher opens this item: resolving/
  // dismissing a Yellow Zone item deliberately does NOT mutate Assignment
  // (see yellow-zone.service.ts's module comment for why), so if a human
  // confirmed/rejected the assignment through the normal Assignments flow
  // in the meantime, this field is what lets the UI say so rather than
  // silently showing a stale "needs attention."
  assignmentStatus: assignmentStatusSchema,
  assignedToUserId: z.string().nullable(),
  assignedToUserName: z.string().nullable(),
  resolutionNotes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});
export type YellowZoneItemDto = z.infer<typeof yellowZoneItemSchema>;

export const yellowZoneListQuerySchema = paginationQuerySchema.extend({
  status: yellowZoneStatusSchema.optional(),
  priority: yellowZonePrioritySchema.optional(),
});
export type YellowZoneListQuery = z.infer<typeof yellowZoneListQuerySchema>;

export const yellowZoneListResponseSchema = z.object({
  items: z.array(yellowZoneItemSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type YellowZoneListResponse = z.infer<typeof yellowZoneListResponseSchema>;

export const yellowZoneStatusCountsSchema = z.object({
  PENDING: z.number(),
  IN_REVIEW: z.number(),
  RESOLVED: z.number(),
  DISMISSED: z.number(),
});
export type YellowZoneStatusCounts = z.infer<typeof yellowZoneStatusCountsSchema>;

export const resolveYellowZoneRequestSchema = z.object({
  resolutionNotes: z.string().trim().min(1).max(2000),
});
export type ResolveYellowZoneRequest = z.infer<typeof resolveYellowZoneRequestSchema>;

export const dismissYellowZoneRequestSchema = z.object({
  resolutionNotes: z.string().trim().max(2000).optional(),
});
export type DismissYellowZoneRequest = z.infer<typeof dismissYellowZoneRequestSchema>;
