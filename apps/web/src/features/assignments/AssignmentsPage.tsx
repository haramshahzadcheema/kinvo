import type { AssignmentStatusValue } from '@kinvo/contracts';
import { useState } from 'react';
import { AssignmentRow } from './AssignmentRow';
import { ASSIGNMENT_STATUS_LABEL, ASSIGNMENT_STATUS_STYLE } from './statusStyles';
import { useAssignmentRowActions } from './useAssignmentRowActions';
import { useAssignmentStatusCounts, useAssignments } from './useAssignments';

const STAT_STATUSES: AssignmentStatusValue[] = ['PENDING', 'CONFIRMED', 'REJECTED', 'NO_SHOW'];

// The flat, cross-ship "call list" the Assignment API was designed around
// (see docs/ARCHITECTURE.md's Phase 3 Decisions log) — every invitation
// across every ship, filterable by status, actioned from one place
// instead of hunting through each ship's drawer. Defaults to PENDING
// since that's the actual outreach queue a dispatcher works from.
export function AssignmentsPage() {
  const [statusFilter, setStatusFilter] = useState<AssignmentStatusValue | ''>('PENDING');
  const { data, isLoading, isError } = useAssignments({
    status: statusFilter || undefined,
    sortBy: 'invitedAt',
    sortOrder: 'desc',
    pageSize: 50,
  });
  const { counts, isLoading: countsLoading } = useAssignmentStatusCounts();
  const actions = useAssignmentRowActions();

  // Changing the filter can hide the row whose reason/attempt form is
  // currently open (it's still "open" in state, just no longer rendered)
  // — close it explicitly so switching back to that status later doesn't
  // resurface a stale half-filled form.
  function changeStatusFilter(status: AssignmentStatusValue | '') {
    actions.closeRowAction();
    setStatusFilter(status);
  }

  const assignments = data?.items ?? [];

  return (
    <div className="animate-[tideIn_0.2s_ease]">
      <div className="mb-5">
        <h1 className="text-lg font-bold text-[#0F2A38]">Assignments</h1>
        <p className="mt-0.5 text-xs text-[#8B9AA3]">
          Every driver invitation across your ships, in one place.
        </p>
      </div>

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {STAT_STATUSES.map((status) => (
          <button
            key={status}
            onClick={() => changeStatusFilter(statusFilter === status ? '' : status)}
            className="rounded-xl border px-3.5 py-2.5 text-left transition"
            style={{
              borderColor:
                statusFilter === status ? ASSIGNMENT_STATUS_STYLE[status].color : '#ECE1CC',
              background: statusFilter === status ? ASSIGNMENT_STATUS_STYLE[status].bg : '#FFFFFF',
            }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8B9AA3]">
              {ASSIGNMENT_STATUS_LABEL[status]}
            </div>
            {countsLoading ? (
              <div className="mt-1.5 h-5 w-8 animate-pulse rounded bg-[#F0EADC]" />
            ) : (
              <div
                className="mt-0.5 text-lg font-bold"
                style={{ color: ASSIGNMENT_STATUS_STYLE[status].color }}
              >
                {counts[status]}
              </div>
            )}
          </button>
        ))}
      </div>

      {statusFilter && (
        <button
          onClick={() => changeStatusFilter('')}
          className="mb-3.5 text-[11.5px] font-semibold text-[#8B9AA3] hover:text-[#0F2A38]"
        >
          Show all statuses
        </button>
      )}

      {actions.error && <p className="mb-3 text-xs text-[#C1503B]">{actions.error}</p>}

      {isLoading && <AssignmentsListSkeleton />}
      {isError && <p className="text-sm text-[#C1503B]">Could not load assignments.</p>}

      {!isLoading && !isError && assignments.length === 0 && (
        <div className="rounded-2xl border border-[#ECE1CC] bg-white py-10 text-center">
          <div className="mb-1 text-[15px] font-semibold text-[#0F2A38]">
            {statusFilter
              ? `No ${ASSIGNMENT_STATUS_LABEL[statusFilter].toLowerCase()} assignments`
              : 'No assignments yet'}
          </div>
          <p className="text-xs text-[#8B9AA3]">
            Invite drivers to a destination from a ship's detail view to get started.
          </p>
        </div>
      )}

      {!isLoading && assignments.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {assignments.map((a) => (
            <AssignmentRow
              key={a.id}
              assignment={a}
              showContext
              rowAction={actions.rowAction}
              reasonInput={actions.reasonInput}
              attemptOutcome={actions.attemptOutcome}
              attemptNotes={actions.attemptNotes}
              onReasonChange={actions.setReasonInput}
              onAttemptOutcomeChange={actions.setAttemptOutcome}
              onAttemptNotesChange={actions.setAttemptNotes}
              onOpenRowAction={(kind) => actions.openRowAction(a.id, kind)}
              onCloseRowAction={actions.closeRowAction}
              onConfirm={() => actions.confirm(a.id)}
              onWithdraw={() => actions.withdraw(a.id)}
              onNoShow={() => actions.noShow(a.id)}
              onReject={() => actions.reject(a.id)}
              onCancel={() => actions.cancel(a.id)}
              onLogAttempt={() => actions.logAttempt(a.id)}
              isMutating={actions.isMutating}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AssignmentsListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-lg border border-[#ECE1CC] p-2.5">
          <div className="h-3 w-1/3 rounded bg-[#F0EADC]" />
          <div className="mt-2 h-2.5 w-1/2 rounded bg-[#F5F0E6]" />
        </div>
      ))}
    </div>
  );
}
