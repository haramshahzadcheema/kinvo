import type { InsightsSummaryDto } from '@kinvo/contracts';
import { apiGet } from '../../lib/apiClient';

export const insightsApi = {
  getSummary: (days = 30) => apiGet<InsightsSummaryDto>(`/api/v1/insights/summary?days=${days}`),
};
