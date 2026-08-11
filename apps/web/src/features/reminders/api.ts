import type {
  CreateReminderCampaignRequest,
  ReminderCampaignDto,
  ReminderCampaignListResponse,
  ReminderCampaignStatusValue,
} from '@kinvo/contracts';
import { apiGet, apiPatch, apiPost } from '../../lib/apiClient';

export interface ReminderCampaignListParams {
  status?: ReminderCampaignStatusValue;
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

export const remindersApi = {
  list: (params: ReminderCampaignListParams = {}) =>
    apiGet<ReminderCampaignListResponse>(`/api/v1/reminder-campaigns${toQueryString(params)}`),
  create: (body: CreateReminderCampaignRequest) =>
    apiPost<ReminderCampaignDto>('/api/v1/reminder-campaigns', body),
  approve: (id: string) =>
    apiPatch<ReminderCampaignDto>(`/api/v1/reminder-campaigns/${id}/approve`),
  cancel: (id: string) =>
    apiPatch<ReminderCampaignDto>(`/api/v1/reminder-campaigns/${id}/cancel`),
};
