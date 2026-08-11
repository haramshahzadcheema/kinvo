import type { TimelineListResponse } from '@kinvo/contracts';
import { apiGet } from '../../lib/apiClient';

export interface TimelineListParams {
  page?: number;
  pageSize?: number;
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

export const timelineApi = {
  list: (params: TimelineListParams = {}) =>
    apiGet<TimelineListResponse>(`/api/v1/timeline${toQueryString(params)}`),
};
