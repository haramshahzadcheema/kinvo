import { useQuery } from '@tanstack/react-query';
import { insightsApi } from './api';

export function useInsightsSummary(days = 30) {
  return useQuery({
    queryKey: ['insights-summary', days],
    queryFn: () => insightsApi.getSummary(days),
  });
}
