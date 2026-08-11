import { useQuery } from '@tanstack/react-query';
import { timelineApi, type TimelineListParams } from './api';

// No realtime socket event for this feed — same reasoning as Reminders'
// useReminderCampaigns: this is a historical activity log, not a live
// alert, so a plain fetch-on-mount/focus is enough.
export function useTimeline(params: TimelineListParams) {
  return useQuery({
    queryKey: ['timeline', params],
    queryFn: () => timelineApi.list(params),
  });
}
