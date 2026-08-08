import type {
  DismissYellowZoneRequest,
  ResolveYellowZoneRequest,
  YellowZoneItemDto,
  YellowZoneListResponse,
  YellowZonePriorityValue,
  YellowZoneStatusCounts,
  YellowZoneStatusValue,
} from '@kinvo/contracts';
import { apiGet, apiPatch } from '../../lib/apiClient';

export interface YellowZoneListParams {
  status?: YellowZoneStatusValue;
  priority?: YellowZonePriorityValue;
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

export const yellowZoneApi = {
  list: (params: YellowZoneListParams = {}) =>
    apiGet<YellowZoneListResponse>(`/api/v1/yellow-zone${toQueryString(params)}`),
  stats: () => apiGet<YellowZoneStatusCounts>('/api/v1/yellow-zone/stats'),
  get: (id: string) => apiGet<YellowZoneItemDto>(`/api/v1/yellow-zone/${id}`),
  claim: (id: string) => apiPatch<YellowZoneItemDto>(`/api/v1/yellow-zone/${id}/claim`),
  resolve: (id: string, body: ResolveYellowZoneRequest) =>
    apiPatch<YellowZoneItemDto>(`/api/v1/yellow-zone/${id}/resolve`, body),
  dismiss: (id: string, body: DismissYellowZoneRequest) =>
    apiPatch<YellowZoneItemDto>(`/api/v1/yellow-zone/${id}/dismiss`, body),
};
