import type {
  NotificationListResponse,
  NotificationUnreadCount,
} from '@kinvo/contracts';
import { apiGet, apiPatch } from '../../lib/apiClient';

export interface NotificationListParams {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}

function toQueryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const notificationsApi = {
  list: (params: NotificationListParams = {}) =>
    apiGet<NotificationListResponse>(`/api/v1/notifications${toQueryString(params)}`),
  unreadCount: () => apiGet<NotificationUnreadCount>('/api/v1/notifications/unread-count'),
  markRead: (id: string) => apiPatch(`/api/v1/notifications/${id}/read`),
  markAllRead: () => apiPatch<{ count: number }>('/api/v1/notifications/mark-all-read'),
};
