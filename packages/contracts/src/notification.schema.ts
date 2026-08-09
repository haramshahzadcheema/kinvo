import { z } from 'zod';
import { paginationQuerySchema } from './pagination.schema';

// Phase 6's in-app notification inbox — deliberately scoped to a single
// seed type for now (see docs/ARCHITECTURE.md's Phase 6 entry): Yellow
// Zone escalations are the one Phase 0-5 event that's genuinely "the user
// needs to know this, not just that it happened" (see the Decisions log
// for the audit-event-vs-notification reasoning). NotificationType is a
// closed enum, not a free string, because — unlike AssignmentAttempt.
// provider, which is a string specifically to avoid a migration the day a
// second voice provider exists — the set of notification types is owned
// entirely by this codebase, never by an external system, so there's no
// forward-compat reason to give up DB-level validation. Adding a second
// type later is a migration adding one enum value, not a schema redesign.
export const notificationTypeSchema = z.enum(['YELLOW_ZONE_ESCALATED']);
export type NotificationTypeValue = z.infer<typeof notificationTypeSchema>;

// What kind of entity targetId points at — lets the frontend route a
// click without the backend needing to embed a full URL (which would
// couple the API to frontend routing structure).
export const notificationTargetTypeSchema = z.enum(['YELLOW_ZONE_ITEM']);
export type NotificationTargetTypeValue = z.infer<typeof notificationTargetTypeSchema>;

export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  title: z.string(),
  message: z.string(),
  targetType: notificationTargetTypeSchema,
  targetId: z.string(),
  // Single nullable timestamp, not a separate boolean + a third
  // dismissed/archived state — matches the exact shape
  // docs/ARCHITECTURE.md's own Phase 6 sketch specifies
  // (`Notification { orgId, userId, type, payload, readAt }`), and no
  // discovered requirement calls for a third state beyond read/unread.
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;

// NOT z.coerce.boolean() — that coerces via JS truthiness, so the literal
// query string "false" (a non-empty string) parses to `true`, silently
// inverting the filter. An explicit closed set, transformed to a real
// boolean, matches this file's own notificationTypeSchema/
// notificationTargetTypeSchema pattern (and pagination.schema.ts's
// sortOrderSchema) — a value that isn't exactly "true" or "false" fails
// validation with the same 400 every other malformed query param in this
// codebase gets, rather than silently defaulting to some guessed behavior.
const booleanQueryParamSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

export const notificationListQuerySchema = paginationQuerySchema.extend({
  unreadOnly: booleanQueryParamSchema.optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const notificationListResponseSchema = z.object({
  items: z.array(notificationSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

// A dedicated, cheap count endpoint — not derived by paginating the full
// list client-side — same reasoning as YellowZoneStatusCounts's own
// dedicated /stats endpoint: a nav badge needs one number, not a page of
// rows, and this is the query TanStack Query's realtime-triggered
// invalidation hits most often.
export const notificationUnreadCountSchema = z.object({
  count: z.number(),
});
export type NotificationUnreadCount = z.infer<typeof notificationUnreadCountSchema>;
