import type { AnalyticsSummaryDto } from '@kinvo/contracts';
import { apiGet } from '../../lib/apiClient';

export const analyticsApi = {
  getSummary: (days = 7) => apiGet<AnalyticsSummaryDto>(`/api/v1/analytics/summary?days=${days}`),
};
