import type { DismissYellowZoneRequest, ResolveYellowZoneRequest } from '@kinvo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
