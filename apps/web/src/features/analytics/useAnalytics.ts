import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from './api';

// A daily-rollup view, not a live one — same reasoning as Timeline's own
// useTimeline: plain fetch-on-mount/focus, no realtime socket event.
export function useAnalyticsSummary(days = 7) {
  return useQuery({
    queryKey: ['analytics-summary', days],
    queryFn: () => analyticsApi.getSummary(days),
  });
}
