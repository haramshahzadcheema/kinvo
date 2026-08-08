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

export const REALTIME_EVENT_NAMES = [
  YELLOW_ZONE_CREATED,
  YELLOW_ZONE_UPDATED,
  YELLOW_ZONE_RESOLVED,
  YELLOW_ZONE_DISMISSED,
] as const;
export type RealtimeEventName = (typeof REALTIME_EVENT_NAMES)[number];

export interface YellowZoneRealtimePayload {
  item: YellowZoneItemDto;
}
