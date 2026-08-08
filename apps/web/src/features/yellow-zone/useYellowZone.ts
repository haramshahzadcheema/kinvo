import type {
  DismissYellowZoneRequest,
  ResolveYellowZoneRequest,
  YellowZonePriorityValue,
} from '@kinvo/contracts';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { yellowZoneApi, type YellowZoneListParams } from './api';

const YELLOW_ZONE_KEY = ['yellow-zone'] as const;

// No refetchInterval here, unlike Phase 4's Calls page — Yellow Zone is
// realtime-driven (RealtimeProvider invalidates this exact query key on
// every yellow_zone.* socket event), so polling would just be redundant
// traffic on top of a signal that already exists. A REST fetch on mount/
// focus is still TanStack Query's own default behavior, which is what
// keeps this correct even if the socket connection is down.
export function useYellowZone(params: YellowZoneListParams) {
  return useQuery({
    queryKey: [...YELLOW_ZONE_KEY, params],
    queryFn: () => yellowZoneApi.list(params),
  });
}

export function useYellowZoneStatusCounts() {
  return useQuery({
    queryKey: [...YELLOW_ZONE_KEY, 'stats'],
    queryFn: () => yellowZoneApi.stats(),
  });
}

const PRIORITY_FILTER_VALUES: YellowZonePriorityValue[] = ['HIGH', 'MEDIUM', 'LOW'];

// Cheap count-only calls through the existing list endpoint, mirroring
// useAssignmentStatusCounts/useCallStatusCounts's exact pattern — used by
// the priority breakdown on the Yellow Zone page, not the top-line status
// counts (which come from the dedicated /stats endpoint above).
export function useYellowZonePriorityCounts() {
  const results = useQueries({
    queries: PRIORITY_FILTER_VALUES.map((priority) => ({
      queryKey: [...YELLOW_ZONE_KEY, 'priority-stats', priority],
      queryFn: () => yellowZoneApi.list({ priority, status: 'PENDING', pageSize: 1 }),
    })),
  });

  const counts = Object.fromEntries(
    PRIORITY_FILTER_VALUES.map((priority, i) => [priority, results[i]?.data?.total ?? 0]),
  ) as Record<YellowZonePriorityValue, number>;

  return { counts, isLoading: results.some((r) => r.isLoading) };
}

export function useYellowZoneMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: YELLOW_ZONE_KEY });
  };

  const claim = useMutation({
    mutationFn: (id: string) => yellowZoneApi.claim(id),
    onSuccess: invalidate,
  });

  const unclaim = useMutation({
    mutationFn: (id: string) => yellowZoneApi.unclaim(id),
    onSuccess: invalidate,
  });

  const resolve = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ResolveYellowZoneRequest }) =>
      yellowZoneApi.resolve(id, input),
    onSuccess: invalidate,
  });

  const dismiss = useMutation({
    mutationFn: ({ id, input }: { id: string; input: DismissYellowZoneRequest }) =>
      yellowZoneApi.dismiss(id, input),
    onSuccess: invalidate,
  });

  return { claim, unclaim, resolve, dismiss };
}
