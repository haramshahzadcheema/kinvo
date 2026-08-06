import type {
  CreateDriverRequest,
  DriverAvailabilityValue,
  DriverListResponse,
  DriverDto,
  UpdateDriverRequest,
} from '@kinvo/contracts';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/apiClient';

export interface DriverListParams {
  search?: string;
  availability?: DriverAvailabilityValue;
  truckType?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'fullName' | 'availability' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
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

export const driversApi = {
  list: (params: DriverListParams = {}) =>
    apiGet<DriverListResponse>(`/api/v1/drivers${toQueryString(params)}`),
  get: (driverId: string) => apiGet<DriverDto>(`/api/v1/drivers/${driverId}`),
  create: (input: CreateDriverRequest) => apiPost<DriverDto>('/api/v1/drivers', input),
  update: (driverId: string, input: UpdateDriverRequest) =>
    apiPatch<DriverDto>(`/api/v1/drivers/${driverId}`, input),
  remove: (driverId: string) => apiDelete<void>(`/api/v1/drivers/${driverId}`),
};
