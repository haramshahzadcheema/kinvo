import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi, type NotificationListParams } from './api';

const NOTIFICATIONS_KEY = ['notifications'] as const;

// No refetchInterval — same reasoning as useYellowZone.ts: this is
// realtime-driven (RealtimeProvider invalidates this exact query key on
// every notification.* socket event), so polling would be redundant
// traffic on top of a signal that already exists.
export function useNotifications(params: NotificationListParams) {
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, params],
    queryFn: () => notificationsApi.list(params),
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, 'unread-count'],
    queryFn: () => notificationsApi.unreadCount(),
  });
}

export function useNotificationMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidate,
  });

  return { markRead, markAllRead };
}
