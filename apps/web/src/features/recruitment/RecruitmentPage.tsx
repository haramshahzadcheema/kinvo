import { useShips } from '../ships/useShips';

// Campaigns group, Phase D — deliberately NOT a new Prisma model or
// endpoint. Investigation before building this (see the "Kinvo UI redesign
// plan" memory) confirmed needed/confirmed/pending already exist on
// TruckRequirementDto, and rejectedCount was a one-line aggregation add
// (ships.service.ts's loadRequirementCounts) — this page is just a
// destination-level re-slice of the exact same ship data ShipsPage/
// Dashboard already render, for ships still actively recruiting.
// "Manage drivers" intentionally reuses the existing Ships tab + ship
// detail drawer (TruckRequirementDrivers' real invite/confirm/reject
// flow) rather than inventing a second, parallel outreach UI — same
// precedent as Dashboard's shortages panel, which already just navigates
// to Ships instead of deep-linking into a drawer.
export function RecruitmentPage({ onNavigate }: { onNavigate: (tab: 'ships') => void }) {
  const { data, isLoading, isError } = useShips({ status: 'RECRUITING', pageSize: 50 });

  const campaigns = (data?.items ?? []).flatMap((ship) =>
    ship.truckRequirements
      .filter((req) => req.confirmedCount < req.quantityNeeded)
      .map((req) => ({
        key: req.id,
        shipName: ship.shipName,
        destination: req.destination,
        truckType: req.truckType,
        rate: req.rate,
        rateCurrency: req.rateCurrency,
        needed: req.quantityNeeded,
        confirmed: req.confirmedCount,
        pending: req.pendingCount,
        rejected: req.rejectedCount,
      })),
  );

  return (
    <div className="animate-[tideIn_0.2s_ease]">
      {isLoading && <ListSkeleton />}
      {isError && <p className="text-sm text-[var(--danger)]">Could not load recruitment campaigns.</p>}

      {!isLoading && !isError && campaigns.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] py-10 text-center">
          <div className="mb-1 text-[length:var(--text-10)] font-semibold text-[var(--text-strong)]">
            No open recruitment campaigns
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Every destination on an active ship is fully staffed right now.
          </p>
        </div>
      )}

      {!isLoading && campaigns.length > 0 && (
        <div className="flex flex-col gap-3.5">
          {campaigns.map((c) => {
            const pct = c.needed > 0 ? Math.min(100, Math.round((c.confirmed / c.needed) * 100)) : 0;
            return (
              <div
                key={c.key}
                onClick={() => onNavigate('ships')}
                className="cursor-pointer rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[length:var(--text-10)] font-bold text-[var(--text-strong)]">
                      {c.shipName} <span className="text-[var(--text-muted)]">→</span> {c.destination}
                    </div>
                    <div className="mt-0.5 font-mono text-[length:var(--text-5)] text-[var(--text-muted)]">
                      {c.truckType} · {c.rate ? `${c.rate} ${c.rateCurrency ?? ''}` : 'Rate not set'}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-4 gap-2.5">
                  <Stat label="Needed" value={c.needed} tone="var(--text-strong)" />
                  <Stat label="Confirmed" value={c.confirmed} tone="var(--success)" />
                  <Stat label="Pending" value={c.pending} tone="var(--warning)" />
                  <Stat label="Rejected" value={c.rejected} tone="var(--danger)" />
                </div>

                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                  <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="font-mono text-lg font-semibold" style={{ color: tone }}>
        {value}
      </div>
      <div className="text-[length:var(--text-2)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      {[0, 1].map((i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
          <div className="h-3.5 w-1/2 rounded bg-[var(--surface-muted-3)]" />
          <div className="mt-3 h-8 w-full rounded bg-[var(--surface-muted-2)]" />
        </div>
      ))}
    </div>
  );
}
