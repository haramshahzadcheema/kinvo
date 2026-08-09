import type { ActiveVoiceCallDto, AttemptOutcomeValue, ResolvedVoiceCallDto } from '@kinvo/contracts';
import { useState } from 'react';
import { formatDateTime, formatRelativeTime } from '../../lib/format';
import { ATTEMPT_OUTCOME_LABEL } from '../assignments/statusStyles';
import { CALL_STATUS_LABEL, CALL_STATUS_STYLE } from './statusStyles';
import { useActiveCalls, useCallStatusCounts, useCalls } from './useCalls';

const STAT_OUTCOMES: AttemptOutcomeValue[] = ['CONFIRMED', 'REJECTED', 'UNREACHABLE', 'SYSTEM_ERROR'];
const PAGE_SIZE = 20;

// The dedicated home for CALL-E's automated outreach — separate from
// Assignments (where a call is *initiated*, since that's where the
// assignment's current status lives) so a dispatcher has one place to
// see what CALL-E has been doing across every ship, not just the one
// they happen to have open. Read-only by design: see calls/api.ts for
// why "call again" stays an Assignment-resource action.
export function CallsPage({ onNavigate }: { onNavigate: (tab: 'assignments') => void }) {
  const [outcomeFilter, setOutcomeFilter] = useState<AttemptOutcomeValue | ''>('');
  const [page, setPage] = useState(1);
  const [selectedCall, setSelectedCall] = useState<ResolvedVoiceCallDto | ActiveVoiceCallDto | null>(
    null,
  );

  const { counts, activeCount, isLoading: countsLoading } = useCallStatusCounts();
  const { data: active, isLoading: activeLoading, isError: activeError } = useActiveCalls();
  const { data, isLoading, isError } = useCalls({
    outcome: outcomeFilter || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  function changeOutcomeFilter(outcome: AttemptOutcomeValue | '') {
    setOutcomeFilter(outcome);
    setPage(1);
  }

  const calls = data?.items ?? [];
  const activeCalls = active?.items ?? [];

  return (
    <div className="animate-[tideIn_0.2s_ease]">
      <div className="mb-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-3.5 py-3 text-left">
          <div className="text-[length:var(--text-2)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Calling now
          </div>
          {countsLoading ? (
            <div className="mt-1.5 h-6 w-8 animate-pulse rounded bg-[var(--surface-muted-3)]" />
          ) : (
            <div className="mt-0.5 font-mono text-xl font-bold" style={{ color: CALL_STATUS_STYLE.CALLING.color }}>
              {activeCount}
            </div>
          )}
        </div>
        {STAT_OUTCOMES.map((outcome) => (
          <button
            key={outcome}
            onClick={() => changeOutcomeFilter(outcomeFilter === outcome ? '' : outcome)}
            className="rounded-2xl border px-3.5 py-3 text-left transition"
            style={{
              borderColor: outcomeFilter === outcome ? CALL_STATUS_STYLE[outcome].color : 'var(--border)',
              background: outcomeFilter === outcome ? CALL_STATUS_STYLE[outcome].bg : 'var(--surface-card)',
            }}
          >
            <div className="text-[length:var(--text-2)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {ATTEMPT_OUTCOME_LABEL[outcome]}
            </div>
            {countsLoading ? (
              <div className="mt-1.5 h-6 w-8 animate-pulse rounded bg-[var(--surface-muted-3)]" />
            ) : (
              <div className="mt-0.5 font-mono text-xl font-bold" style={{ color: CALL_STATUS_STYLE[outcome].color }}>
                {counts[outcome]}
              </div>
            )}
          </button>
        ))}
      </div>

      {outcomeFilter && (
        <button
          onClick={() => changeOutcomeFilter('')}
          className="mb-3.5 text-[length:var(--text-5)] font-semibold text-[var(--text-muted)] hover:text-[var(--text-strong)]"
        >
          Show all outcomes
        </button>
      )}

      {!activeLoading && !activeError && activeCalls.length > 0 && (
        <div className="mb-3.5 flex flex-col gap-2 rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] p-4.5">
          <h3 className="text-[length:var(--text-3)] font-semibold uppercase tracking-wide text-white/70">
            Calling now
          </h3>
          {activeCalls.map((call) => (
            <div
              key={call.id}
              onClick={() => setSelectedCall(call)}
              className="flex cursor-pointer items-center justify-between gap-2 rounded-xl bg-white/10 px-3.5 py-2.5 transition hover:bg-white/15"
            >
              <div className="min-w-0">
                <span className="truncate text-[length:var(--text-7)] font-semibold text-white">
                  {call.driverName}
                </span>
                <span className="ml-1.5 text-[length:var(--text-4)] text-white/70">
                  {call.shipName} · {call.destination}
                </span>
              </div>
              <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[length:var(--text-2)] font-semibold text-white">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                {CALL_STATUS_LABEL.CALLING}
              </span>
            </div>
          ))}
        </div>
      )}
      {activeLoading && (
        <div className="mb-3.5 flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-2xl bg-[var(--surface-muted-2)]" />
          ))}
        </div>
      )}
      {activeError && (
        <p className="mb-3.5 text-xs text-[var(--danger)]">Could not load active calls.</p>
      )}

      <h3 className="mb-2.5 text-[length:var(--text-4)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Call history
      </h3>

      {isLoading && <CallsListSkeleton />}
      {isError && <p className="text-sm text-[var(--danger)]">Could not load call history.</p>}

      {!isLoading && !isError && calls.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] py-10 text-center">
          <div className="mb-1 text-[length:var(--text-10)] font-semibold text-[var(--text-strong)]">
            {outcomeFilter
              ? `No calls with outcome "${ATTEMPT_OUTCOME_LABEL[outcomeFilter].toLowerCase()}"`
              : 'No automated calls yet'}
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Calls placed to drivers from an assignment's outreach will show up here once resolved.
          </p>
        </div>
      )}

      {!isLoading && calls.length > 0 && (
        <div className="flex flex-col gap-2">
          {calls.map((call) => (
            <CallRow key={call.id} call={call} onOpen={() => setSelectedCall(call)} />
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

      {selectedCall && (
        <CallDetailModal
          call={selectedCall}
          onClose={() => setSelectedCall(null)}
          onViewAssignment={() => {
            setSelectedCall(null);
            onNavigate('assignments');
          }}
        />
      )}
    </div>
  );
}

function isResolvedCall(
  call: ResolvedVoiceCallDto | ActiveVoiceCallDto,
): call is ResolvedVoiceCallDto {
  return 'outcome' in call;
}

function CallRow({ call, onOpen }: { call: ResolvedVoiceCallDto; onOpen: () => void }) {
  const style = CALL_STATUS_STYLE[call.outcome];
  return (
    <div
      onClick={onOpen}
      className="cursor-pointer rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3 transition hover:bg-[var(--surface-page-1)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">{call.driverName}</span>
          <span className="ml-1.5 text-[length:var(--text-4)] text-[var(--text-muted)]">{call.driverPhone}</span>
        </div>
        <span
          className="flex-shrink-0 rounded-full px-2 py-0.5 text-[length:var(--text-2)] font-semibold"
          style={{ background: style.bg, color: style.color }}
        >
          {CALL_STATUS_LABEL[call.outcome]}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[length:var(--text-4)] text-[var(--text-muted)]">
        <span className="truncate">
          {call.shipName} · {call.destination} · {call.truckType}
        </span>
        <span className="flex-shrink-0">{formatRelativeTime(call.attemptedAt)}</span>
      </div>
    </div>
  );
}

function CallsListSkeleton() {
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

function CallDetailModal({
  call,
  onClose,
  onViewAssignment,
}: {
  call: ResolvedVoiceCallDto | ActiveVoiceCallDto;
  onClose: () => void;
  onViewAssignment: () => void;
}) {
  const resolved = isResolvedCall(call);
  const style = resolved ? CALL_STATUS_STYLE[call.outcome] : CALL_STATUS_STYLE.CALLING;
  const label = resolved ? CALL_STATUS_LABEL[call.outcome] : CALL_STATUS_LABEL.CALLING;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-[var(--surface-overlay)]" />
      <div className="relative w-full max-w-md animate-[tideIn_0.15s_ease] rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 shadow-xl">
        <div className="mb-3.5 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[length:var(--text-10)] font-bold text-[var(--text-strong)]">{call.driverName}</h3>
            <p className="mt-0.5 text-[length:var(--text-5)] text-[var(--text-muted)]">{call.driverPhone}</p>
          </div>
          <span
            className="flex-shrink-0 rounded-full px-2.5 py-1 text-[length:var(--text-3)] font-semibold"
            style={{ background: style.bg, color: style.color }}
          >
            {label}
          </span>
        </div>

        <dl className="flex flex-col gap-2 text-[length:var(--text-7)]">
          <DetailRow label="Ship / destination" value={`${call.shipName} · ${call.destination}`} />
          <DetailRow label="Truck type" value={call.truckType} />
          <DetailRow label="Provider" value={call.provider} />
          <DetailRow label="Provider call ID" value={call.externalCallId ?? '—'} mono />
          {resolved ? (
            <>
              <DetailRow label="Called at" value={formatDateTime(call.attemptedAt) ?? '—'} />
              {call.notes && <DetailRow label="Notes" value={call.notes} />}
            </>
          ) : (
            <DetailRow label="Placed at" value={formatDateTime(call.placedAt) ?? '—'} />
          )}
        </dl>

        <div className="mt-4.5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-full border border-[var(--border)] py-2 text-[length:var(--text-7)] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]"
          >
            Close
          </button>
          <button
            onClick={onViewAssignment}
            className="flex-1 rounded-full bg-[var(--accent)] py-2 text-[length:var(--text-7)] font-semibold text-white hover:bg-[var(--accent-hover)]"
          >
            View in Assignments
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--surface-muted)] pb-2">
      <dt className="flex-shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className={`text-right text-[var(--text-strong)] ${mono ? 'font-mono text-[length:var(--text-4)]' : ''}`}>{value}</dd>
    </div>
  );
}
