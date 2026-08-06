import type {
  CreateShipRequest,
  DocumentRequirementDto,
  DocumentRequirementInput,
  ShipDto,
  ShipListResponse,
  ShipStatusValue,
  TruckRequirementDto,
  TruckRequirementInput,
  UpdateShipRequest,
} from '@kinvo/contracts';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/apiClient';

export interface ShipListParams {
  search?: string;
  status?: ShipStatusValue;
  page?: number;
  pageSize?: number;
  sortBy?: 'shipName' | 'eta' | 'status' | 'createdAt' | 'updatedAt';
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

export const shipsApi = {
  list: (params: ShipListParams = {}) =>
    apiGet<ShipListResponse>(`/api/v1/ships${toQueryString(params)}`),
  get: (shipId: string) => apiGet<ShipDto>(`/api/v1/ships/${shipId}`),
  create: (input: CreateShipRequest) => apiPost<ShipDto>('/api/v1/ships', input),
  update: (shipId: string, input: UpdateShipRequest) =>
    apiPatch<ShipDto>(`/api/v1/ships/${shipId}`, input),
  updateStatus: (shipId: string, status: ShipStatusValue) =>
    apiPatch<ShipDto>(`/api/v1/ships/${shipId}/status`, { status }),
  remove: (shipId: string) => apiDelete<void>(`/api/v1/ships/${shipId}`),

  addTruckRequirement: (shipId: string, input: TruckRequirementInput) =>
    apiPost<TruckRequirementDto>(`/api/v1/ships/${shipId}/truck-requirements`, input),
  updateTruckRequirement: (
    shipId: string,
    truckRequirementId: string,
    input: Partial<TruckRequirementInput>,
  ) =>
    apiPatch<TruckRequirementDto>(
      `/api/v1/ships/${shipId}/truck-requirements/${truckRequirementId}`,
      input,
    ),
  removeTruckRequirement: (shipId: string, truckRequirementId: string) =>
    apiDelete<void>(`/api/v1/ships/${shipId}/truck-requirements/${truckRequirementId}`),

  addDocumentRequirement: (shipId: string, input: DocumentRequirementInput) =>
    apiPost<DocumentRequirementDto>(`/api/v1/ships/${shipId}/document-requirements`, input),
  updateDocumentRequirement: (
    shipId: string,
    documentRequirementId: string,
    input: Partial<DocumentRequirementInput>,
  ) =>
    apiPatch<DocumentRequirementDto>(
      `/api/v1/ships/${shipId}/document-requirements/${documentRequirementId}`,
      input,
    ),
  removeDocumentRequirement: (shipId: string, documentRequirementId: string) =>
    apiDelete<void>(`/api/v1/ships/${shipId}/document-requirements/${documentRequirementId}`),
};
