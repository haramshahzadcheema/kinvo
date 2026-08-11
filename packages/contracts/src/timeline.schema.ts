import { z } from 'zod';
import { paginationQuerySchema } from './pagination.schema';

// Phase E (Kinvo UI redesign, Intelligence group): a read-only feed over
// AuditLogEntry, the persisted audit log Phase 3 already writes to on
// every ship/document/assignment/yellow-zone/reminder-campaign mutation.
// Deliberately global (this organization's whole operational history, not
// one ship's) — the Kinvo.dc.html mockup's "Operations Timeline" is a
// single flat feed, not a per-ship drill-down, and nothing in this
// codebase's data model would make a per-ship version meaningfully
// cheaper (see timeline.service.ts for the entity-resolution cost either
// way). `type` is the raw AuditEventType string (e.g. "ship.created") —
// `title`/`detail` are server-resolved, human-readable text derived from
// it plus whatever real data (names, reasons) that event's metadata or a
// join can honestly supply; a sparse event with no resolvable detail
// renders with `detail: null` rather than a fabricated sentence.
export const timelineEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  actorUserId: z.string(),
  actorName: z.string(),
  createdAt: z.string().datetime(),
});
export type TimelineEntryDto = z.infer<typeof timelineEntrySchema>;

export const timelineListQuerySchema = paginationQuerySchema;
export type TimelineListQuery = z.infer<typeof timelineListQuerySchema>;

export const timelineListResponseSchema = z.object({
  items: z.array(timelineEntrySchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type TimelineListResponse = z.infer<typeof timelineListResponseSchema>;
