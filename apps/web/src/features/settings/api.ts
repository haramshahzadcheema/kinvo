import type { Settings, UpdateSettingsRequest } from '@kinvo/contracts';
import { apiGet, apiPatch } from '../../lib/apiClient';

export const settingsApi = {
  get: () => apiGet<Settings>('/api/v1/me/preferences'),
  update: (input: UpdateSettingsRequest) =>
    apiPatch<Settings>('/api/v1/me/preferences', input),
};
