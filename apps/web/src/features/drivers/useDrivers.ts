import type {
  CreateDriverRequest,
  DriverAvailabilityValue,
  UpdateDriverRequest,
} from '@kinvo/contracts';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { driversApi, type DriverListParams } from './api';

const DRIVERS_KEY = ['drivers'] as const;

export function useDrivers(params: DriverListParams) {
  return useQuery({
    queryKey: [...DRIVERS_KEY, params],
    queryFn: () => driversApi.list(params),
  });
}

// Mirrors useShipStats: four cheap count-only calls through the existing
// tenant-scoped/RBAC'd list endpoint, no dedicated aggregate route.
const STATS_AVAILABILITY: DriverAvailabilityValue[] = ['IDLE', 'ON_CALL', 'CONFIRMED', 'ESCALATED'];

export function useDriverStats() {
  const results = useQueries({
    queries: STATS_AVAILABILITY.map((availability) => ({
      queryKey: [...DRIVERS_KEY, 'stats', availability],
      queryFn: () => driversApi.list({ availability, pageSize: 1 }),
    })),
  });

  const counts = Object.fromEntries(
    STATS_AVAILABILITY.map((availability, i) => [availability, results[i]?.data?.total ?? 0]),
  ) as Record<DriverAvailabilityValue, number>;

  return { counts, isLoading: results.some((r) => r.isLoading) };
}

export function useDriver(driverId: string | null) {
  return useQuery({
    queryKey: [...DRIVERS_KEY, driverId],
    queryFn: () => driversApi.get(driverId as string),
    enabled: driverId !== null,
  });
}

export function useDriverMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: DRIVERS_KEY });

  const createDriver = useMutation({
    mutationFn: (input: CreateDriverRequest) => driversApi.create(input),
    onSuccess: invalidate,
  });

  const updateDriver = useMutation({
    mutationFn: ({ driverId, input }: { driverId: string; input: UpdateDriverRequest }) =>
      driversApi.update(driverId, input),
    onSuccess: invalidate,
  });

  const deleteDriver = useMutation({
    mutationFn: (driverId: string) => driversApi.remove(driverId),
    onSuccess: invalidate,
  });

  return { createDriver, updateDriver, deleteDriver };
}
