import type { AssignmentStatusValue } from '@kinvo/contracts';
import { useState } from 'react';
import { isApiError } from '../../lib/useAuth';
import { AssignmentRow } from './AssignmentRow';
import { AVAILABILITY_LABEL, AVAILABILITY_STYLE } from '../drivers/statusStyles';
import { useDrivers } from '../drivers/useDrivers';
import { useAssignmentMutations, useAssignments } from './useAssignments';
import { useAssignmentRowActions } from './useAssignmentRowActions';

const ACTIVE_STATUSES: AssignmentStatusValue[] = ['PENDING', 'CONFIRMED'];

interface TruckRequirementDriversProps {
  truckRequirementId: string;
  quantityNeeded: number;
  confirmedCount: number;
  pendingCount: number;
}

// Embedded per truck-requirement card in ShipDetailDrawer. Collapsed by
// default so the drawer's existing destinations list doesn't grow
// unreadable once every destination has drivers attached to it — the
// same "expand to work on it" pattern the drawer already uses for
// "+ Add destination"/"+ Add document".
export function TruckRequirementDrivers({
  truckRequirementId,
  quantityNeeded,
  confirmedCount,
  pendingCount,
}: TruckRequirementDriversProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg bg-[var(--surface-page-1)] px-2.5 py-1.5 text-left"
      >
        <span className="text-[length:var(--text-5)] font-semibold text-[var(--text-strong)]">
          {confirmedCount}/{quantityNeeded} confirmed
          {pendingCount > 0 && (
            <span className="ml-1.5 font-normal text-[var(--warning)]">
              · {pendingCount} pending outreach
            </span>
          )}
        </span>
        <span className="flex-shrink-0 text-[length:var(--text-4)] font-semibold text-[var(--accent)]">
          {expanded ? 'Hide drivers' : 'Manage drivers'}
        </span>
      </button>

      {expanded && <AssignmentsPanel truckRequirementId={truckRequirementId} />}
    </div>
  );
}

function AssignmentsPanel({ truckRequirementId }: { truckRequirementId: string }) {
  const { data, isLoading } = useAssignments({ truckRequirementId, pageSize: 50 });
  const createMutation = useAssignmentMutations().createAssignment;
  const actions = useAssignmentRowActions();
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const assignments = data?.items ?? [];
  const activeDriverIds = new Set(
    assignments.filter((a) => ACTIVE_STATUSES.includes(a.status)).map((a) => a.driverId),
  );

  async function handleInvite(driverId: string) {
    setInviteError(null);
    try {
      await createMutation.mutateAsync({ truckRequirementId, driverId });
    } catch (err) {
      setInviteError(isApiError(err) ? err.message : 'Could not invite this driver.');
    }
  }

  const error = actions.error ?? inviteError;

  return (
    <div className="mt-2 rounded-xl border border-[var(--surface-muted)] bg-[var(--surface-card)] p-3">
      {error && <p className="mb-2 text-[length:var(--text-4)] text-[var(--danger)]">{error}</p>}

      {isLoading && <p className="text-[length:var(--text-5)] text-[var(--text-muted)]">Loading drivers…</p>}
      {!isLoading && assignments.length === 0 && (
        <p className="text-[length:var(--text-5)] text-[var(--text-muted)]">No drivers invited yet.</p>
      )}

      <div className="flex flex-col gap-2">
        {assignments.map((a) => (
          <AssignmentRow
            key={a.id}
            assignment={a}
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
            onCallDriver={() => actions.callDriver(a.id)}
            isMutating={actions.isMutating}
          />
        ))}
      </div>

      <div className="mt-3 border-t border-[var(--surface-muted)] pt-3">
        <button
          onClick={() => setShowInvite((v) => !v)}
          className="text-[length:var(--text-5)] font-semibold text-[var(--accent)]"
        >
          {showInvite ? 'Cancel' : '+ Invite driver'}
        </button>
        {showInvite && (
          <DriverPicker
            excludeDriverIds={activeDriverIds}
            onInvite={handleInvite}
            isInviting={createMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}

// Defaults to IDLE-only, matching Driver.availability's meaning (a
// non-IDLE driver is already committed elsewhere) — the "Show unavailable
// drivers too" toggle is the escape hatch for a dispatcher who knows a
// driver is about to free up. Drivers already actively engaged
// (PENDING/CONFIRMED) on *this* requirement are excluded outright rather
// than merely flagged, since re-inviting them would just hit the
// backend's one-active-engagement conflict.
function DriverPicker({
  excludeDriverIds,
  onInvite,
  isInviting,
}: {
  excludeDriverIds: Set<string>;
  onInvite: (driverId: string) => void;
  isInviting: boolean;
}) {
  const [search, setSearch] = useState('');
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  const { data, isLoading } = useDrivers({
    search: search || undefined,
    availability: includeUnavailable ? undefined : 'IDLE',
    pageSize: 20,
  });
  const drivers = (data?.items ?? []).filter((driver) => !excludeDriverIds.has(driver.id));

  return (
    <div className="mt-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-page-1)] p-2.5">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search drivers by name or phone"
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-2.5 py-1.5 text-[length:var(--text-6)] outline-none"
      />
      <label className="mt-2 flex items-center gap-1.5 text-[length:var(--text-4)] text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={includeUnavailable}
          onChange={(e) => setIncludeUnavailable(e.target.checked)}
        />
        Show unavailable drivers too
      </label>

      <div className="mt-2 flex max-h-52 flex-col gap-1.5 overflow-y-auto">
        {isLoading && <p className="text-[length:var(--text-5)] text-[var(--text-muted)]">Loading…</p>}
        {!isLoading && drivers.length === 0 && (
          <p className="text-[length:var(--text-5)] text-[var(--text-muted)]">No matching drivers.</p>
        )}
        {drivers.map((driver) => (
          <div
            key={driver.id}
            className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-card)] px-2.5 py-1.5"
          >
            <div className="min-w-0">
              <div className="truncate text-[length:var(--text-6)] font-semibold text-[var(--text-strong)]">
                {driver.fullName}
              </div>
              <div className="flex items-center gap-1.5 text-[length:var(--text-3)] text-[var(--text-muted)]">
                <span>{driver.phone}</span>
                <span
                  className="rounded-full px-1.5 py-0.5 font-semibold"
                  style={{
                    background: AVAILABILITY_STYLE[driver.availability].bg,
                    color: AVAILABILITY_STYLE[driver.availability].color,
                  }}
                >
                  {AVAILABILITY_LABEL[driver.availability]}
                </span>
              </div>
            </div>
            <button
              onClick={() => onInvite(driver.id)}
              disabled={isInviting}
              className="flex-shrink-0 rounded-full bg-[var(--accent)] px-3 py-1 text-[length:var(--text-4)] font-semibold text-white disabled:opacity-50"
            >
              Assign
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
