import type {
  AssignmentAttemptDto,
  AssignmentDto,
  AssignmentListResponse,
  AssignmentStatusValue,
  CancelAssignmentRequest,
  CreateAssignmentRequest,
  LogAttemptRequest,
  RejectAssignmentRequest,
} from '@kinvo/contracts';
import { apiGet, apiPatch, apiPost } from '../../lib/apiClient';

export interface AssignmentListParams {
  truckRequirementId?: string;
  driverId?: string;
  status?: AssignmentStatusValue;
  page?: number;
  pageSize?: number;
  sortBy?: 'invitedAt' | 'createdAt';
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

export const assignmentsApi = {
  list: (params: AssignmentListParams = {}) =>
    apiGet<AssignmentListResponse>(`/api/v1/assignments${toQueryString(params)}`),
  get: (assignmentId: string) => apiGet<AssignmentDto>(`/api/v1/assignments/${assignmentId}`),
  create: (input: CreateAssignmentRequest) =>
    apiPost<AssignmentDto>('/api/v1/assignments', input),
  confirm: (assignmentId: string) =>
    apiPatch<AssignmentDto>(`/api/v1/assignments/${assignmentId}/confirm`),
  reject: (assignmentId: string, input: RejectAssignmentRequest) =>
    apiPatch<AssignmentDto>(`/api/v1/assignments/${assignmentId}/reject`, input),
  withdraw: (assignmentId: string) =>
    apiPatch<AssignmentDto>(`/api/v1/assignments/${assignmentId}/withdraw`),
  cancel: (assignmentId: string, input: CancelAssignmentRequest) =>
    apiPatch<AssignmentDto>(`/api/v1/assignments/${assignmentId}/cancel`, input),
  markNoShow: (assignmentId: string) =>
    apiPatch<AssignmentDto>(`/api/v1/assignments/${assignmentId}/no-show`),
  logAttempt: (assignmentId: string, input: LogAttemptRequest) =>
    apiPost<AssignmentAttemptDto>(`/api/v1/assignments/${assignmentId}/attempts`, input),
};
