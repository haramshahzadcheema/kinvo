import type { AssignmentDto, AttemptOutcomeValue } from '@kinvo/contracts';
import { formatDateTime, formatRate } from '../../lib/format';
import {
  ASSIGNMENT_STATUS_LABEL,
  ASSIGNMENT_STATUS_STYLE,
  ATTEMPT_OUTCOME_LABEL,
  LOGGABLE_ATTEMPT_OUTCOMES,
} from './statusStyles';
import type { RowAction, RowActionKind } from './useAssignmentRowActions';

// Shared between the ship drawer's per-requirement panel (showContext
// false — the requirement's own destination/ship is already the
// surrounding context) and the flat cross-ship Assignments page
// (showContext true — every row needs to say which ship/destination it's
// for, since rows from many requirements are interleaved).
export function AssignmentRow({
  assignment,
  showContext = false,
  rowAction,
  reasonInput,
  attemptOutcome,
  attemptNotes,
  onReasonChange,
  onAttemptOutcomeChange,
  onAttemptNotesChange,
  onOpenRowAction,
  onCloseRowAction,
  onConfirm,
  onWithdraw,
  onNoShow,
  onReject,
  onCancel,
  onLogAttempt,
  isMutating,
}: {
  assignment: AssignmentDto;
  showContext?: boolean;
  rowAction: RowAction;
  reasonInput: string;
  attemptOutcome: AttemptOutcomeValue;
  attemptNotes: string;
  onReasonChange: (v: string) => void;
  onAttemptOutcomeChange: (v: AttemptOutcomeValue) => void;
  onAttemptNotesChange: (v: string) => void;
  onOpenRowAction: (kind: RowActionKind) => void;
  onCloseRowAction: () => void;
  onConfirm: () => void;
  onWithdraw: () => void;
  onNoShow: () => void;
  onReject: () => void;
  onCancel: () => void;
  onLogAttempt: () => void;
  isMutating: boolean;
}) {
  const isActiveRow = rowAction?.assignmentId === assignment.id;
  // A null agreedRate means "use the requirement's posted rate" (see
  // createAssignmentRequestSchema's comment) — never displayed as "not
  // set" unless the requirement itself has no rate either. assignment.rate
  // is the requirement's own posted rate, denormalized onto the DTO
  // precisely so this fallback works without a second fetch.
  const displayedRate = assignment.agreedRate ?? assignment.rate;
  const declineReason = assignment.cancellationReason ?? assignment.rejectionReason;

  return (
    <div className="rounded-lg border border-[#ECE1CC] p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold text-[#0F2A38]">
            {assignment.driverName}
          </div>
          {showContext && (
            <div className="text-[10.5px] text-[#8B9AA3]">
              {assignment.shipName} · {assignment.destination}
            </div>
          )}
          <div className="text-[10.5px] text-[#8B9AA3]">
            {assignment.driverPhone} · {formatRate(displayedRate, assignment.rateCurrency)}
          </div>
          <div className="mt-0.5 text-[10px] text-[#8B9AA3]">
            Invited {formatDateTime(assignment.invitedAt)}
            {assignment.respondedAt && ` · Responded ${formatDateTime(assignment.respondedAt)}`}
          </div>
        </div>
        <span
          className="flex-shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-[10.5px] font-semibold"
          style={{
            background: ASSIGNMENT_STATUS_STYLE[assignment.status].bg,
            color: ASSIGNMENT_STATUS_STYLE[assignment.status].color,
          }}
        >
          {ASSIGNMENT_STATUS_LABEL[assignment.status]}
        </span>
      </div>

      {declineReason && (
        <div className="mt-1.5 rounded-lg bg-[#FBF6EE] px-2 py-1 text-[10.5px] text-[#5C6B75]">
          {declineReason}
        </div>
      )}

      {assignment.status === 'PENDING' && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            onClick={onConfirm}
            disabled={isMutating}
            className="rounded-full bg-[#1E7A8C] px-2.5 py-1 text-[10.5px] font-semibold text-white disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            onClick={() => onOpenRowAction('logAttempt')}
            disabled={isMutating}
            className="rounded-full border border-[#ECE1CC] px-2.5 py-1 text-[10.5px] font-semibold text-[#1E7A8C] disabled:opacity-50"
          >
            Log attempt
          </button>
          <button
            onClick={() => onOpenRowAction('reject')}
            disabled={isMutating}
            className="rounded-full border border-[#F0C4B8] px-2.5 py-1 text-[10.5px] font-semibold text-[#C1503B] disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={onWithdraw}
            disabled={isMutating}
            className="rounded-full bg-[#F3EDDD] px-2.5 py-1 text-[10.5px] font-semibold text-[#0F2A38] disabled:opacity-50"
          >
            Withdraw
          </button>
        </div>
      )}

      {assignment.status === 'CONFIRMED' && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            onClick={() => onOpenRowAction('cancel')}
            disabled={isMutating}
            className="rounded-full border border-[#F0C4B8] px-2.5 py-1 text-[10.5px] font-semibold text-[#C1503B] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onNoShow}
            disabled={isMutating}
            className="rounded-full border border-[#ECE1CC] px-2.5 py-1 text-[10.5px] font-semibold text-[#1E7A8C] disabled:opacity-50"
          >
            Mark no-show
          </button>
        </div>
      )}

      {isActiveRow && rowAction?.kind === 'reject' && (
        <div className="mt-2 rounded-lg bg-[#FBF6EE] p-2">
          <input
            value={reasonInput}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="Reason (optional)"
            className="w-full rounded-lg border border-[#ECE1CC] px-2 py-1.5 text-[11.5px] outline-none"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button onClick={onCloseRowAction} className="text-[10.5px] text-[#8B9AA3]">
              Cancel
            </button>
            <button
              onClick={onReject}
              disabled={isMutating}
              className="rounded-full bg-[#C1503B] px-2.5 py-1 text-[10.5px] font-semibold text-white disabled:opacity-50"
            >
              Confirm reject
            </button>
          </div>
        </div>
      )}

      {isActiveRow && rowAction?.kind === 'cancel' && (
        <div className="mt-2 rounded-lg bg-[#FBF6EE] p-2">
          <input
            value={reasonInput}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="Reason (required)"
            className="w-full rounded-lg border border-[#ECE1CC] px-2 py-1.5 text-[11.5px] outline-none"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button onClick={onCloseRowAction} className="text-[10.5px] text-[#8B9AA3]">
              Back
            </button>
            <button
              onClick={onCancel}
              disabled={isMutating || !reasonInput.trim()}
              className="rounded-full bg-[#C1503B] px-2.5 py-1 text-[10.5px] font-semibold text-white disabled:opacity-50"
            >
              Confirm cancel
            </button>
          </div>
        </div>
      )}

      {isActiveRow && rowAction?.kind === 'logAttempt' && (
        <div className="mt-2 rounded-lg bg-[#FBF6EE] p-2">
          <select
            value={attemptOutcome}
            onChange={(e) => onAttemptOutcomeChange(e.target.value as AttemptOutcomeValue)}
            className="w-full rounded-lg border border-[#ECE1CC] px-2 py-1.5 text-[11.5px] outline-none"
          >
            {LOGGABLE_ATTEMPT_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {ATTEMPT_OUTCOME_LABEL[outcome]}
              </option>
            ))}
          </select>
          <input
            value={attemptNotes}
            onChange={(e) => onAttemptNotesChange(e.target.value)}
            placeholder="Notes (optional)"
            className="mt-1.5 w-full rounded-lg border border-[#ECE1CC] px-2 py-1.5 text-[11.5px] outline-none"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button onClick={onCloseRowAction} className="text-[10.5px] text-[#8B9AA3]">
              Cancel
            </button>
            <button
              onClick={onLogAttempt}
              disabled={isMutating}
              className="rounded-full bg-[#1E7A8C] px-2.5 py-1 text-[10.5px] font-semibold text-white disabled:opacity-50"
            >
              Save attempt
            </button>
          </div>
        </div>
      )}

      {assignment.attempts.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10.5px] font-semibold text-[#8B9AA3]">
            {assignment.attempts.length} contact attempt
            {assignment.attempts.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-1.5 flex flex-col gap-1">
            {assignment.attempts.map((att) => (
              <div key={att.id} className="text-[10.5px] text-[#5C6B75]">
                {formatDateTime(att.attemptedAt)} · {ATTEMPT_OUTCOME_LABEL[att.outcome]}
                {att.notes && ` — ${att.notes}`}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
