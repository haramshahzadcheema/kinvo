import type { AttemptOutcomeValue } from '@kinvo/contracts';
import { useState } from 'react';
import { isApiError } from '../../lib/useAuth';
import { useAssignmentMutations } from './useAssignments';

export type RowActionKind = 'reject' | 'cancel' | 'logAttempt';
export type RowAction = { assignmentId: string; kind: RowActionKind } | null;

// Shared between TruckRequirementDrivers.tsx (scoped to one truck
// requirement, embedded in the ship drawer) and AssignmentsPage.tsx (the
// flat cross-ship call list) — both surfaces drive the exact same
// assignment state machine and shouldn't reimplement the reason/attempt
// inline-form bookkeeping twice.
export function useAssignmentRowActions() {
  const mutations = useAssignmentMutations();
  const [error, setError] = useState<string | null>(null);
  const [rowAction, setRowAction] = useState<RowAction>(null);
  const [reasonInput, setReasonInput] = useState('');
  const [attemptOutcome, setAttemptOutcome] = useState<AttemptOutcomeValue>('NO_ANSWER');
  const [attemptNotes, setAttemptNotes] = useState('');

  const isMutating =
    mutations.confirmAssignment.isPending ||
    mutations.withdrawAssignment.isPending ||
    mutations.markNoShow.isPending ||
    mutations.rejectAssignment.isPending ||
    mutations.cancelAssignment.isPending ||
    mutations.logAttempt.isPending;

  function closeRowAction() {
    setRowAction(null);
    setReasonInput('');
    setAttemptOutcome('NO_ANSWER');
    setAttemptNotes('');
  }

  function openRowAction(assignmentId: string, kind: RowActionKind) {
    setRowAction({ assignmentId, kind });
    setReasonInput('');
    setAttemptOutcome('NO_ANSWER');
    setAttemptNotes('');
  }

  async function confirm(assignmentId: string) {
    setError(null);
    try {
      await mutations.confirmAssignment.mutateAsync(assignmentId);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not confirm this assignment.');
    }
  }

  async function withdraw(assignmentId: string) {
    setError(null);
    try {
      await mutations.withdrawAssignment.mutateAsync(assignmentId);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not withdraw this invitation.');
    }
  }

  async function noShow(assignmentId: string) {
    setError(null);
    try {
      await mutations.markNoShow.mutateAsync(assignmentId);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not mark this driver as a no-show.');
    }
  }

  async function reject(assignmentId: string) {
    setError(null);
    try {
      await mutations.rejectAssignment.mutateAsync({
        assignmentId,
        input: { reason: reasonInput.trim() ? reasonInput.trim() : undefined },
      });
      closeRowAction();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not reject this assignment.');
    }
  }

  async function cancel(assignmentId: string) {
    if (!reasonInput.trim()) return;
    setError(null);
    try {
      await mutations.cancelAssignment.mutateAsync({
        assignmentId,
        input: { reason: reasonInput.trim() },
      });
      closeRowAction();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not cancel this assignment.');
    }
  }

  async function logAttempt(assignmentId: string) {
    setError(null);
    try {
      await mutations.logAttempt.mutateAsync({
        assignmentId,
        input: {
          outcome: attemptOutcome,
          notes: attemptNotes.trim() ? attemptNotes.trim() : undefined,
        },
      });
      closeRowAction();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not log this attempt.');
    }
  }

  return {
    error,
    rowAction,
    reasonInput,
    attemptOutcome,
    attemptNotes,
    setReasonInput,
    setAttemptOutcome,
    setAttemptNotes,
    openRowAction,
    closeRowAction,
    isMutating,
    confirm,
    withdraw,
    noShow,
    reject,
    cancel,
    logAttempt,
  };
}
