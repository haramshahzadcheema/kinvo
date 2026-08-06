import type {
  CreateShipRequest,
  DocumentRequirementInput,
  ShipStatusValue,
  TruckRequirementInput,
  UpdateShipRequest,
} from '@kinvo/contracts';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { shipsApi, type ShipListParams } from './api';

const SHIPS_KEY = ['ships'] as const;

export function useShips(params: ShipListParams) {
  return useQuery({
    queryKey: [...SHIPS_KEY, params],
    queryFn: () => shipsApi.list(params),
  });
}

// Small dashboard-strip counts, one per operationally meaningful status.
// Reuses the existing list endpoint with pageSize: 1 (only `total` is
// read) rather than adding a dedicated aggregate endpoint — four cheap,
// indexed COUNT queries through the same tenant-scoped/RBAC'd route,
// no new backend surface for a handful of numbers.
const STATS_STATUSES: ShipStatusValue[] = ['RECRUITING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];

export function useShipStats() {
  const results = useQueries({
    queries: STATS_STATUSES.map((status) => ({
      queryKey: [...SHIPS_KEY, 'stats', status],
      queryFn: () => shipsApi.list({ status, pageSize: 1 }),
    })),
  });

  const counts = Object.fromEntries(
    STATS_STATUSES.map((status, i) => [status, results[i]?.data?.total ?? 0]),
  ) as Record<ShipStatusValue, number>;

  return { counts, isLoading: results.some((r) => r.isLoading) };
}

export function useShip(shipId: string | null) {
  return useQuery({
    queryKey: [...SHIPS_KEY, shipId],
    queryFn: () => shipsApi.get(shipId as string),
    enabled: shipId !== null,
  });
}

export function useShipMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: SHIPS_KEY });

  const createShip = useMutation({
    mutationFn: (input: CreateShipRequest) => shipsApi.create(input),
    onSuccess: invalidate,
  });

  const updateShip = useMutation({
    mutationFn: ({ shipId, input }: { shipId: string; input: UpdateShipRequest }) =>
      shipsApi.update(shipId, input),
    onSuccess: invalidate,
  });

  const updateShipStatus = useMutation({
    mutationFn: ({ shipId, status }: { shipId: string; status: ShipStatusValue }) =>
      shipsApi.updateStatus(shipId, status),
    onSuccess: invalidate,
  });

  const deleteShip = useMutation({
    mutationFn: (shipId: string) => shipsApi.remove(shipId),
    onSuccess: invalidate,
  });

  const addTruckRequirement = useMutation({
    mutationFn: ({ shipId, input }: { shipId: string; input: TruckRequirementInput }) =>
      shipsApi.addTruckRequirement(shipId, input),
    onSuccess: invalidate,
  });

  const removeTruckRequirement = useMutation({
    mutationFn: ({ shipId, truckRequirementId }: { shipId: string; truckRequirementId: string }) =>
      shipsApi.removeTruckRequirement(shipId, truckRequirementId),
    onSuccess: invalidate,
  });

  const addDocumentRequirement = useMutation({
    mutationFn: ({ shipId, input }: { shipId: string; input: DocumentRequirementInput }) =>
      shipsApi.addDocumentRequirement(shipId, input),
    onSuccess: invalidate,
  });

  const removeDocumentRequirement = useMutation({
    mutationFn: ({
      shipId,
      documentRequirementId,
    }: {
      shipId: string;
      documentRequirementId: string;
    }) => shipsApi.removeDocumentRequirement(shipId, documentRequirementId),
    onSuccess: invalidate,
  });

  return {
    createShip,
    updateShip,
    updateShipStatus,
    deleteShip,
    addTruckRequirement,
    removeTruckRequirement,
    addDocumentRequirement,
    removeDocumentRequirement,
  };
}
