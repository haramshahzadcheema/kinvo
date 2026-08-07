import type { AttemptOutcomeValue } from '@kinvo/contracts';
import { useQueries, useQuery } from '@tanstack/react-query';
import { voiceCallsApi, type VoiceCallListParams } from './api';

const CALLS_KEY = ['voice-calls'] as const;
const ACTIVE_CALLS_KEY = ['voice-calls', 'active'] as const;

export function useCalls(params: VoiceCallListParams) {
  return useQuery({
    queryKey: [...CALLS_KEY, params],
    queryFn: () => voiceCallsApi.list(params),
  });
}

export function useActiveCalls() {
  return useQuery({
    queryKey: ACTIVE_CALLS_KEY,
    queryFn: () => voiceCallsApi.listActive(),
    // Same reasoning as useAssignments' own conditional polling (Phase 4):
    // only poll while there's actually something in flight to watch
    // resolve, and only while this tab is genuinely focused/visible —
    // TanStack Query's own focusManager already gates that.
    refetchInterval: (query) => ((query.state.data?.items.length ?? 0) > 0 ? 4000 : false),
  });
}

// Mirrors useAssignmentStatusCounts' exact pattern (useAssignments.ts):
// cheap count-only calls through the existing paginated list endpoint for
// stat tiles, rather than a dedicated aggregate route.
const STAT_OUTCOMES: AttemptOutcomeValue[] = ['CONFIRMED', 'REJECTED', 'UNREACHABLE', 'SYSTEM_ERROR'];

export function useCallStatusCounts() {
  const results = useQueries({
    queries: STAT_OUTCOMES.map((outcome) => ({
      queryKey: [...CALLS_KEY, 'stats', outcome],
      queryFn: () => voiceCallsApi.list({ outcome, pageSize: 1 }),
    })),
  });
  const { data: active, isLoading: activeLoading } = useActiveCalls();

  const counts = Object.fromEntries(
    STAT_OUTCOMES.map((outcome, i) => [outcome, results[i]?.data?.total ?? 0]),
  ) as Record<AttemptOutcomeValue, number>;

  return {
    counts,
    activeCount: active?.items.length ?? 0,
    isLoading: results.some((r) => r.isLoading) || activeLoading,
  };
}
