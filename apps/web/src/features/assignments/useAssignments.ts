import type {
  AssignmentStatusValue,
  CancelAssignmentRequest,
  CreateAssignmentRequest,
  LogAttemptRequest,
  RejectAssignmentRequest,
} from '@kinvo/contracts';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { assignmentsApi, type AssignmentListParams } from './api';

const ASSIGNMENTS_KEY = ['assignments'] as const;

export function useAssignments(params: AssignmentListParams) {
  return useQuery({
    queryKey: [...ASSIGNMENTS_KEY, params],
    queryFn: () => assignmentsApi.list(params),
    // Poll only while at least one row in this exact result has a call in
    // flight (pendingVoiceCall !== null) — an automated confirmation call
    // usually resolves within seconds to a couple of minutes, and a
    // dispatcher watching this list should see that resolution on its own,
    // not just after a manual refresh. Self-disabling: the moment nothing
    // is pending, this reverts to the rest of the app's established
    // "no polling, blanket-invalidate-on-mutation" convention.
    refetchInterval: (query) => {
      const hasPendingCall = query.state.data?.items.some(
        (item) => item.pendingVoiceCall !== null,
      );
      return hasPendingCall ? 4000 : false;
    },
  });
}

// Mirrors useShipStats/useDriverStats: cheap count-only calls through the
// existing tenant-scoped/RBAC'd list endpoint for the Assignments page's
// stat tiles, rather than a dedicated aggregate route.
const STAT_STATUSES: AssignmentStatusValue[] = ['PENDING', 'CONFIRMED', 'REJECTED', 'NO_SHOW'];

export function useAssignmentStatusCounts() {
  const results = useQueries({
    queries: STAT_STATUSES.map((status) => ({
      queryKey: [...ASSIGNMENTS_KEY, 'stats', status],
      queryFn: () => assignmentsApi.list({ status, pageSize: 1 }),
    })),
  });

  const counts = Object.fromEntries(
    STAT_STATUSES.map((status, i) => [status, results[i]?.data?.total ?? 0]),
  ) as Record<AssignmentStatusValue, number>;

  return { counts, isLoading: results.some((r) => r.isLoading) };
}

// Every mutation here changes state that's also read from two other
// features' caches: a truck requirement's confirmedCount/pendingCount
// live on ShipDto (useShips), and a driver's availability/currentShipId
// live on DriverDto (useDrivers) — both are recomputed server-side as a
// side effect of these calls, so both caches are invalidated alongside
// this feature's own, matching the "blanket invalidate, no optimistic
// updates" convention established in useShips.ts/useDrivers.ts.
export function useAssignmentMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ASSIGNMENTS_KEY });
    queryClient.invalidateQueries({ queryKey: ['ships'] });
    queryClient.invalidateQueries({ queryKey: ['drivers'] });
  };

  const createAssignment = useMutation({
    mutationFn: (input: CreateAssignmentRequest) => assignmentsApi.create(input),
    onSuccess: invalidate,
  });

  const confirmAssignment = useMutation({
    mutationFn: (assignmentId: string) => assignmentsApi.confirm(assignmentId),
    onSuccess: invalidate,
  });

  const rejectAssignment = useMutation({
    mutationFn: ({ assignmentId, input }: { assignmentId: string; input: RejectAssignmentRequest }) =>
      assignmentsApi.reject(assignmentId, input),
    onSuccess: invalidate,
  });

  const withdrawAssignment = useMutation({
    mutationFn: (assignmentId: string) => assignmentsApi.withdraw(assignmentId),
    onSuccess: invalidate,
  });

  const cancelAssignment = useMutation({
    mutationFn: ({ assignmentId, input }: { assignmentId: string; input: CancelAssignmentRequest }) =>
      assignmentsApi.cancel(assignmentId, input),
    onSuccess: invalidate,
  });

  const markNoShow = useMutation({
    mutationFn: (assignmentId: string) => assignmentsApi.markNoShow(assignmentId),
    onSuccess: invalidate,
  });

  const logAttempt = useMutation({
    mutationFn: ({ assignmentId, input }: { assignmentId: string; input: LogAttemptRequest }) =>
      assignmentsApi.logAttempt(assignmentId, input),
    onSuccess: invalidate,
  });

  const placeVoiceCall = useMutation({
    mutationFn: (assignmentId: string) => assignmentsApi.placeVoiceCall(assignmentId),
    onSuccess: invalidate,
  });

  return {
    createAssignment,
    confirmAssignment,
    rejectAssignment,
    withdrawAssignment,
    cancelAssignment,
    markNoShow,
    logAttempt,
    placeVoiceCall,
  };
}
