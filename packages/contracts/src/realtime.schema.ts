import type { NotificationDto } from './notification.schema';
import type { YellowZoneItemDto } from './yellowZone.schema';

// The complete set of realtime events the API ever emits — shared here so
// the backend's emit call sites and the frontend's socket listener can
// never drift on an event name or payload shape. Every payload is
// deliberately minimal (just the item) — sockets are a cache-invalidation
// signal for TanStack Query, never a parallel copy of server state; see
// docs/ARCHITECTURE.md's Phase 5 realtime section for why a client must
// always be able to treat a missed/dropped event as "a REST refetch will
// still show the correct state," not as data loss.
export const YELLOW_ZONE_CREATED = 'yellow_zone.created';
export const YELLOW_ZONE_UPDATED = 'yellow_zone.updated';
export const YELLOW_ZONE_RESOLVED = 'yellow_zone.resolved';
export const YELLOW_ZONE_DISMISSED = 'yellow_zone.dismissed';

// Phase 6 — delivered to the recipient's user room (`user:${userId}`), not
// the organization room; a notification is per-user-private, and the
// organization room is read by every connected member regardless of who a
// given notification is for. NOTIFICATION_READ covers both a single
// mark-read and mark-all-read (the frontend always just refetches on
// either) — it exists specifically so a second open tab for the same user
// converges to the same read state without a manual refresh, the same
// property Yellow Zone's own events give the org-wide queue.
export const NOTIFICATION_CREATED = 'notification.created';
export const NOTIFICATION_READ = 'notification.read';

export const REALTIME_EVENT_NAMES = [
  YELLOW_ZONE_CREATED,
  YELLOW_ZONE_UPDATED,
  YELLOW_ZONE_RESOLVED,
  YELLOW_ZONE_DISMISSED,
  NOTIFICATION_CREATED,
  NOTIFICATION_READ,
] as const;
export type RealtimeEventName = (typeof REALTIME_EVENT_NAMES)[number];

export interface YellowZoneRealtimePayload {
  item: YellowZoneItemDto;
}

// `notification` is present for NOTIFICATION_CREATED (always exactly one
// new row) but omitted for NOTIFICATION_READ, which fires for both a
// single mark-read and mark-all-read — there's no single item to name in
// the bulk case, and the client doesn't need one: it's cache invalidation
// either way, matching Yellow Zone's own "the client always refetches
// through REST" principle.
export interface NotificationRealtimePayload {
  notification?: NotificationDto;
}
