import type { CreateReminderCampaignRequest } from '@kinvo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { remindersApi, type ReminderCampaignListParams } from './api';

const REMINDERS_KEY = ['reminder-campaigns'] as const;

// No realtime socket event for this feature (unlike Yellow Zone/
// Notifications) — a reminder campaign isn't an urgent live alert, and
// mutation-triggered invalidation (below) already keeps this fresh for the
// user who just acted; a plain fetch-on-mount/focus is fine for the rest.
export function useReminderCampaigns(params: ReminderCampaignListParams) {
  return useQuery({
    queryKey: [...REMINDERS_KEY, params],
    queryFn: () => remindersApi.list(params),
  });
}

export function useReminderCampaignMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: REMINDERS_KEY });
  };

  const create = useMutation({
    mutationFn: (input: CreateReminderCampaignRequest) => remindersApi.create(input),
    onSuccess: invalidate,
  });

  const approve = useMutation({
    mutationFn: (id: string) => remindersApi.approve(id),
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => remindersApi.cancel(id),
    onSuccess: invalidate,
  });

  return { create, approve, cancel };
}
