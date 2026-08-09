import type { YellowZoneItemDto, YellowZonePriorityValue, YellowZoneStatusValue } from '@kinvo/contracts';
import { useState } from 'react';
import { formatDateTime, formatRelativeTime } from '../../lib/format';
import { useRealtimeConnection } from '../../lib/useRealtimeConnection';
import { isApiError, useAuth } from '../../lib/useAuth';
import { ASSIGNMENT_STATUS_LABEL } from '../assignments/statusStyles';
import { yellowZoneApi } from './api';
import {
  YELLOW_ZONE_PRIORITY_DOTS,
  YELLOW_ZONE_PRIORITY_LABEL,
  YELLOW_ZONE_PRIORITY_STYLE,
  YELLOW_ZONE_STATUS_LABEL,
  YELLOW_ZONE_STATUS_STYLE,
} from './statusStyles';
import { useYellowZone, useYellowZoneMutations, useYellowZoneStatusCounts } from './useYellowZone';

const STATUS_FILTERS: YellowZoneStatusValue[] = ['PENDING', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'];
const PRIORITY_FILTERS: YellowZonePriorityValue[] = ['HIGH', 'MEDIUM', 'LOW'];
const PAGE_SIZE = 20;

// Phase 5's escalation queue — deliberately fed by unresolved OUTBOUND
// calls (SYSTEM_ERROR AssignmentAttempts), not a literal inbound-call
// concept CALL-E doesn't support. See docs/ARCHITECTURE.md's Phase 5
// Decisions log (Option A) for the full reasoning. Realtime-driven: new
// items and status changes arrive live via RealtimeProvider's socket
// listener, which invalidates this page's queries — no polling here.
export function YellowZonePage({ onNavigate }: { onNavigate: (tab: 'assignments') => void }) {
  const [statusFilter, setStatusFilter] = useState<YellowZoneStatusValue | ''>('PENDING');
  const [priorityFilter, setPriorityFilter] = useState<YellowZonePriorityValue | ''>('');
  const [page, setPage] = useState(1);
  const [selectedItem, setSelectedItem] = useState<YellowZoneItemDto | null>(null);
  const connectionStatus = useRealtimeConnection();

  const { data: counts, isLoading: countsLoading } = useYellowZoneStatusCounts();
  const { data, isLoading, isError } = useYellowZone({
    status: statusFilter || undefined,
    priority: priorityFilter || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  function changeStatusFilter(status: YellowZoneStatusValue | '') {
    setStatusFilter(status);
    setPage(1);
  }

  function changePriorityFilter(priority: YellowZonePriorityValue | '') {
    setPriorityFilter((current) => (current === priority ? '' : priority));
    setPage(1);
  }

  const items = data?.items ?? [];

  return (
    <div className="animate-[tideIn_0.2s_ease]">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-[var(--text-strong)]">Yellow Zone</h1>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Automated calls CALL-E couldn't resolve on its own — reviewed and cleared here.
          </p>
        </div>
        {connectionStatus === 'connecting' && (
          <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-[var(--surface-neutral-chip)] px-2.5 py-1 text-[length:var(--text-3)] font-semibold text-[var(--text-muted)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            Reconnecting…
          </span>
        )}
      </div>

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {STATUS_FILTERS.map((status) => (
          <button
            key={status}
            onClick={() => changeStatusFilter(statusFilter === status ? '' : status)}
            className="rounded-xl border px-3.5 py-2.5 text-left transition"
            style={{
              borderColor: statusFilter === status ? YELLOW_ZONE_STATUS_STYLE[status].color : 'var(--border)',
              background: statusFilter === status ? YELLOW_ZONE_STATUS_STYLE[status].bg : 'var(--surface-card)',
            }}
          >
            <div className="text-[length:var(--text-2)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {YELLOW_ZONE_STATUS_LABEL[status]}
            </div>
            {countsLoading ? (
              <div className="mt-1.5 h-5 w-8 animate-pulse rounded bg-[var(--surface-muted-3)]" />
            ) : (
              <div
                className="mt-0.5 text-lg font-bold"
                style={{ color: YELLOW_ZONE_STATUS_STYLE[status].color }}
              >
                {counts?.[status] ?? 0}
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <span className="text-[length:var(--text-3)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Priority
        </span>
        {PRIORITY_FILTERS.map((priority) => (
          <button
            key={priority}
            onClick={() => changePriorityFilter(priority)}
            className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[length:var(--text-4)] font-semibold transition"
            style={{
              borderColor: priorityFilter === priority ? YELLOW_ZONE_PRIORITY_STYLE[priority].color : 'var(--border)',
              background: priorityFilter === priority ? YELLOW_ZONE_PRIORITY_STYLE[priority].bg : 'var(--surface-card)',
              color: priorityFilter === priority ? YELLOW_ZONE_PRIORITY_STYLE[priority].color : 'var(--text-secondary)',
            }}
          >
            <PriorityDots priority={priority} />
            {YELLOW_ZONE_PRIORITY_LABEL[priority]}
          </button>
        ))}
        {(statusFilter || priorityFilter) && (
          <button
            onClick={() => {
              changeStatusFilter('');
              setPriorityFilter('');
            }}
            className="text-[length:var(--text-4)] font-semibold text-[var(--text-muted)] hover:text-[var(--text-strong)]"
          >
            Clear filters
          </button>
        )}
      </div>

      {isLoading && <YellowZoneListSkeleton />}
      {isError && <p className="text-sm text-[var(--danger)]">Could not load the Yellow Zone queue.</p>}

      {!isLoading && !isError && items.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] py-10 text-center">
          <div className="mb-1 text-[length:var(--text-10)] font-semibold text-[var(--text-strong)]">
            {statusFilter === 'PENDING' || statusFilter === ''
              ? 'Good — nothing needs your attention.'
              : `No ${YELLOW_ZONE_STATUS_LABEL[statusFilter || 'PENDING'].toLowerCase()} items`}
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Every automated call CALL-E couldn't resolve on its own will show up here.
          </p>
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <YellowZoneRow key={item.id} item={item} onOpen={() => setSelectedItem(item)} />
          ))}
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="mt-3.5 flex items-center justify-between text-[length:var(--text-5)] text-[var(--text-secondary)]">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 font-semibold hover:bg-[var(--surface-card-alt)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {data.page} of {data.totalPages} · {data.total} total
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page >= data.totalPages}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 font-semibold hover:bg-[var(--surface-card-alt)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {selectedItem && (
        <YellowZoneDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onClaimed={setSelectedItem}
          onViewAssignment={() => {
            setSelectedItem(null);
            onNavigate('assignments');
          }}
        />
      )}
    </div>
  );
}

function PriorityDots({ priority }: { priority: YellowZonePriorityValue }) {
  const filled = YELLOW_ZONE_PRIORITY_DOTS[priority];
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: i < filled ? 'currentColor' : 'var(--border-strong)' }}
        />
      ))}
    </span>
  );
}

function YellowZoneRow({ item, onOpen }: { item: YellowZoneItemDto; onOpen: () => void }) {
  const statusStyle = YELLOW_ZONE_STATUS_STYLE[item.status];
  const priorityStyle = YELLOW_ZONE_PRIORITY_STYLE[item.priority];
  return (
    <div
      onClick={onOpen}
      className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3.5 py-3 transition hover:bg-[var(--surface-page-1)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">{item.driverName}</span>
          <span className="ml-1.5 text-[length:var(--text-4)] text-[var(--text-muted)]">
            {item.shipName} · {item.destination}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <span
            className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[length:var(--text-2)] font-semibold"
            style={{ background: priorityStyle.bg, color: priorityStyle.color }}
          >
            <PriorityDots priority={item.priority} />
            {item.priority}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[length:var(--text-2)] font-semibold"
            style={{ background: statusStyle.bg, color: statusStyle.color }}
          >
            {YELLOW_ZONE_STATUS_LABEL[item.status]}
          </span>
        </div>
      </div>
      <p className="mt-1.5 truncate text-[length:var(--text-5)] text-[var(--text-secondary)]">{item.reason}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[length:var(--text-4)] text-[var(--text-muted)]">
        <span>{item.assignedToUserName ? `Claimed by ${item.assignedToUserName}` : 'Unclaimed'}</span>
        <span className="flex-shrink-0">{formatRelativeTime(item.createdAt)}</span>
      </div>
    </div>
  );
}

function YellowZoneListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-lg border border-[var(--border)] p-3">
          <div className="h-3 w-1/3 rounded bg-[var(--surface-muted-3)]" />
          <div className="mt-2 h-2.5 w-1/2 rounded bg-[var(--surface-muted-2)]" />
        </div>
      ))}
    </div>
  );
}

type ActionMode = 'none' | 'resolve' | 'dismiss';

function YellowZoneDetailModal({
  item,
  onClose,
  onClaimed,
  onViewAssignment,
}: {
  item: YellowZoneItemDto;
  onClose: () => void;
  onClaimed: (item: YellowZoneItemDto) => void;
  onViewAssignment: () => void;
}) {
  const { auth } = useAuth();
  const mutations = useYellowZoneMutations();
  const [actionMode, setActionMode] = useState<ActionMode>('none');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const statusStyle = YELLOW_ZONE_STATUS_STYLE[item.status];
  const priorityStyle = YELLOW_ZONE_PRIORITY_STYLE[item.priority];
  const isMutating =
    mutations.claim.isPending ||
    mutations.unclaim.isPending ||
    mutations.resolve.isPending ||
    mutations.dismiss.isPending;
  const isClaimant = item.assignedToUserId !== null && item.assignedToUserId === auth?.user.id;

  // claim()/unclaim() intentionally keep the modal open (so a dispatcher
  // can move straight into resolve/dismiss, or reconsider after releasing)
  // — unlike resolve/dismiss's onClose(), they must hand the mutation's
  // own response back to the parent so `item` (a snapshot passed down at
  // open-time, not a live query result) reflects the new status/owner
  // instead of silently going stale.
  async function handleClaim() {
    setError(null);
    try {
      const updated = await mutations.claim.mutateAsync(item.id);
      onClaimed(updated);
    } catch (err) {
      // A 409 here means someone else claimed it in the moment between
      // this modal opening and the click — not a transient failure worth
      // a raw error string. Fetch the item's real current state (the
      // failed mutation gave us no fresh DTO to work with) and hand THAT
      // to onClaimed, so the modal immediately reflects who actually has
      // it instead of leaving the dispatcher looking at a dead "Claim"
      // button for an item that already moved on.
      if (isApiError(err) && err.status === 409) {
        setError('Someone else just claimed this item — showing its current status.');
        try {
          onClaimed(await yellowZoneApi.get(item.id));
        } catch {
          // Best-effort refresh; the error message above still stands.
        }
        return;
      }
      setError(isApiError(err) ? err.message : 'Could not claim this item.');
    }
  }

  async function handleUnclaim() {
    setError(null);
    try {
      const updated = await mutations.unclaim.mutateAsync(item.id);
      onClaimed(updated);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not release this item.');
    }
  }

  async function handleResolve() {
    setError(null);
    try {
      await mutations.resolve.mutateAsync({ id: item.id, input: { resolutionNotes: notes } });
      onClose();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not resolve this item.');
    }
  }

  async function handleDismiss() {
    setError(null);
    try {
      await mutations.dismiss.mutateAsync({
        id: item.id,
        input: notes.trim() ? { resolutionNotes: notes } : {},
      });
      onClose();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not dismiss this item.');
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-[var(--surface-overlay)]" />
      <div className="relative w-full max-w-md animate-[tideIn_0.15s_ease] rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 shadow-xl">
        <div className="mb-3.5 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[length:var(--text-10)] font-bold text-[var(--text-strong)]">{item.driverName}</h3>
            <p className="mt-0.5 text-[length:var(--text-5)] text-[var(--text-muted)]">{item.driverPhone}</p>
          </div>
          <div className="flex flex-shrink-0 flex-col items-end gap-1">
            <span
              className="rounded-full px-2.5 py-1 text-[length:var(--text-3)] font-semibold"
              style={{ background: statusStyle.bg, color: statusStyle.color }}
            >
              {YELLOW_ZONE_STATUS_LABEL[item.status]}
            </span>
            <span
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[length:var(--text-3)] font-semibold"
              style={{ background: priorityStyle.bg, color: priorityStyle.color }}
            >
              <PriorityDots priority={item.priority} />
              {YELLOW_ZONE_PRIORITY_LABEL[item.priority]}
            </span>
          </div>
        </div>

        <dl className="flex flex-col gap-2 text-[length:var(--text-7)]">
          <DetailRow label="Ship / destination" value={`${item.shipName} · ${item.destination}`} />
          <DetailRow label="Truck type" value={item.truckType} />
          <DetailRow label="Why it was escalated" value={item.reason} />
          <DetailRow label="Escalated" value={formatDateTime(item.createdAt) ?? '—'} />
          <DetailRow label="Owner" value={item.assignedToUserName ?? 'Unclaimed'} />
          {item.resolutionNotes && <DetailRow label="Resolution notes" value={item.resolutionNotes} />}
        </dl>

        {/* Yellow Zone resolution deliberately never mutates the underlying
            Assignment (see yellow-zone.service.ts's module comment) — a
            dispatcher who separately confirmed/rejected the assignment
            through the normal Assignments flow can leave this item looking
            like it still needs attention when it doesn't. Purely
            informational; no action here writes anything. */}
        {(item.status === 'PENDING' || item.status === 'IN_REVIEW') &&
          item.assignmentStatus !== 'PENDING' && (
            <p className="mt-3 rounded-lg bg-[var(--accent-tint)] px-2.5 py-2 text-[length:var(--text-5)] text-[var(--accent)]">
              The underlying assignment is already{' '}
              <strong>{ASSIGNMENT_STATUS_LABEL[item.assignmentStatus]}</strong> — this item may just
              need dismissing.
            </p>
          )}

        {error && <p className="mt-3 text-[length:var(--text-5)] text-[var(--danger)]">{error}</p>}

        {actionMode !== 'none' && (item.status === 'PENDING' || item.status === 'IN_REVIEW') && (
          <div className="mt-3 rounded-lg bg-[var(--surface-page-1)] p-2.5">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                actionMode === 'resolve' ? 'What did you do? (required)' : 'Reason (optional)'
              }
              rows={2}
              className="w-full resize-none rounded-lg border border-[var(--border)] px-2 py-1.5 text-[length:var(--text-5)] outline-none"
            />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <button
                onClick={() => {
                  setActionMode('none');
                  setNotes('');
                }}
                className="text-[length:var(--text-3)] font-semibold text-[var(--text-muted)]"
              >
                Back
              </button>
              <button
                onClick={actionMode === 'resolve' ? handleResolve : handleDismiss}
                disabled={isMutating || (actionMode === 'resolve' && !notes.trim())}
                className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-[length:var(--text-3)] font-semibold text-white disabled:opacity-50"
              >
                {actionMode === 'resolve' ? 'Confirm resolve' : 'Confirm dismiss'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-4.5 flex flex-wrap gap-2">
          {item.status === 'PENDING' && (
            <button
              onClick={handleClaim}
              disabled={isMutating}
              className="flex-1 rounded-lg bg-[var(--accent)] py-2 text-[length:var(--text-7)] font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              Claim
            </button>
          )}
          {item.status === 'IN_REVIEW' && actionMode === 'none' && (
            <button
              onClick={() => setActionMode('resolve')}
              className="flex-1 rounded-lg bg-[var(--accent)] py-2 text-[length:var(--text-7)] font-semibold text-white hover:bg-[var(--accent-hover)]"
            >
              Resolve
            </button>
          )}
          {/* Claimant-only — see the ownership-model comment in
              yellow-zone.service.ts. Not shown to other dispatchers even
              though the backend's own 403/409 would catch a stray click;
              this is UX clarity, not the authorization boundary itself. */}
          {item.status === 'IN_REVIEW' && actionMode === 'none' && isClaimant && (
            <button
              onClick={handleUnclaim}
              disabled={isMutating}
              className="flex-1 rounded-lg border border-[var(--border)] py-2 text-[length:var(--text-7)] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)] disabled:opacity-50"
            >
              Release
            </button>
          )}
          {(item.status === 'PENDING' || item.status === 'IN_REVIEW') && actionMode === 'none' && (
            <button
              onClick={() => setActionMode('dismiss')}
              className="flex-1 rounded-lg border border-[var(--border)] py-2 text-[length:var(--text-7)] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]"
            >
              Dismiss
            </button>
          )}
          <button
            onClick={onViewAssignment}
            className="flex-1 rounded-lg border border-[var(--border)] py-2 text-[length:var(--text-7)] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]"
          >
            View in Assignments
          </button>
        </div>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-lg py-1.5 text-[length:var(--text-5)] font-semibold text-[var(--text-muted)] hover:text-[var(--text-strong)]"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--surface-muted)] pb-2">
      <dt className="flex-shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className="text-right text-[var(--text-strong)]">{value}</dd>
    </div>
  );
}
