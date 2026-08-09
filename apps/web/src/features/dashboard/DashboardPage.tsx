import type { ReactNode } from 'react';
import { useDrivers, useDriverStats } from '../drivers/useDrivers';
import { AVAILABILITY_LABEL, AVAILABILITY_STYLE } from '../drivers/statusStyles';
import { formatDateTime, formatRelativeTime, isToday } from '../../lib/format';
import { useShips, useShipStats } from '../ships/useShips';
import { SHIP_STATUS_LABEL, SHIP_STATUS_STYLE } from '../ships/statusStyles';
import { YELLOW_ZONE_PRIORITY_STYLE } from '../yellow-zone/statusStyles';
import { useYellowZone, useYellowZoneStatusCounts } from '../yellow-zone/useYellowZone';

export function DashboardPage({
  onNavigate,
}: {
  onNavigate: (tab: 'ships' | 'drivers' | 'yellow-zone', autoOpenCreate?: boolean) => void;
}) {
  const { counts: shipStats, isLoading: shipStatsLoading } = useShipStats();
  const { counts: driverStats, isLoading: driverStatsLoading } = useDriverStats();
  const { data: yellowZoneStats } = useYellowZoneStatusCounts();
  const { data: pendingYellowZone } = useYellowZone({ status: 'PENDING', pageSize: 4 });

  // Reuses the existing list endpoints — no dedicated dashboard/aggregate
  // route, same reasoning as useShipStats/useDriverStats.
  const { data: etaSorted } = useShips({ sortBy: 'eta', sortOrder: 'asc', pageSize: 50 });
  const { data: recentShips } = useShips({ sortBy: 'updatedAt', sortOrder: 'desc', pageSize: 5 });
  const { data: recentDrivers } = useDrivers({
    sortBy: 'updatedAt',
    sortOrder: 'desc',
    pageSize: 5,
  });

  const activeShips = (etaSorted?.items ?? []).filter(
    (s) => s.status !== 'COMPLETED' && s.status !== 'CANCELLED',
  );
  const upcoming = activeShips.filter((s) => s.eta).slice(0, 5);
  const today = activeShips.filter((s) => isToday(s.eta) || isToday(s.reportingTime));

  // confirmedCount/pendingCount are already computed server-side on every
  // truck requirement (see ship.schema.ts) — no separate assignments
  // fetch needed just to answer "what's short-staffed right now."
  const shortages = activeShips
    .flatMap((ship) =>
      ship.truckRequirements
        .filter((req) => req.confirmedCount < req.quantityNeeded)
        .map((req) => ({
          requirementId: req.id,
          shipName: ship.shipName,
          destination: req.destination,
          confirmedCount: req.confirmedCount,
          quantityNeeded: req.quantityNeeded,
          pendingCount: req.pendingCount,
        })),
    )
    .slice(0, 6);

  const isLoading = shipStatsLoading || driverStatsLoading;

  const hasActivity = (recentShips?.items.length ?? 0) > 0 || (recentDrivers?.items.length ?? 0) > 0;

  return (
    <div className="animate-[tideIn_0.2s_ease]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Recruiting" value={shipStats.RECRUITING} tone="var(--warning)" loading={isLoading} onClick={() => onNavigate('ships')} />
        <StatCard label="In progress" value={shipStats.IN_PROGRESS} tone="var(--info)" loading={isLoading} onClick={() => onNavigate('ships')} />
        <StatCard label="Drivers idle" value={driverStats.IDLE} tone="var(--text-secondary)" loading={isLoading} onClick={() => onNavigate('drivers')} />
        <StatCard label="Drivers on call" value={driverStats.ON_CALL} tone="var(--warning)" loading={isLoading} onClick={() => onNavigate('drivers')} />
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-[1.6fr_1fr]">
        <Panel title="Incoming vessels">
          {upcoming.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">No ships with a scheduled ETA yet.</p>
          )}
          <div className="flex flex-col gap-1.5">
            {upcoming.map((ship) => (
              <div
                key={ship.id}
                onClick={() => onNavigate('ships')}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition hover:bg-[var(--surface-page-1)]"
              >
                <div className="min-w-0">
                  <div className="truncate text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">
                    {ship.shipName}
                  </div>
                  <div className="mt-0.5 text-[length:var(--text-4)] text-[var(--text-muted)]">
                    {ship.berth ? `Berth ${ship.berth}` : 'Berth —'}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2.5">
                  <span
                    className="rounded-full px-2 py-0.5 text-[length:var(--text-2)] font-semibold"
                    style={{
                      background: SHIP_STATUS_STYLE[ship.status].bg,
                      color: SHIP_STATUS_STYLE[ship.status].color,
                    }}
                  >
                    {SHIP_STATUS_LABEL[ship.status]}
                  </span>
                  <span className="font-mono text-[length:var(--text-6)] text-[var(--text-secondary)]">
                    {ship.eta ? formatDateTime(ship.eta) : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Activity">
          {!hasActivity && <p className="text-xs text-[var(--text-muted)]">No activity yet.</p>}
          <div className="flex flex-col gap-2">
            {recentShips?.items.slice(0, 3).map((ship) => (
              <div
                key={ship.id}
                onClick={() => onNavigate('ships')}
                className="flex cursor-pointer items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 transition hover:bg-[var(--surface-page-1)]"
              >
                <span className="min-w-0 truncate text-[length:var(--text-6)] text-[var(--text-secondary)]">
                  Ship <span className="font-semibold text-[var(--text-strong)]">{ship.shipName}</span> updated
                </span>
                <span className="flex-shrink-0 text-[length:var(--text-3)] text-[var(--text-muted)]">
                  {formatRelativeTime(ship.updatedAt)}
                </span>
              </div>
            ))}
            {recentDrivers?.items.slice(0, 3).map((driver) => (
              <div
                key={driver.id}
                onClick={() => onNavigate('drivers')}
                className="flex cursor-pointer items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 transition hover:bg-[var(--surface-page-1)]"
              >
                <span className="min-w-0 truncate text-[length:var(--text-6)] text-[var(--text-secondary)]">
                  Driver <span className="font-semibold text-[var(--text-strong)]">{driver.fullName}</span> updated
                </span>
                <span className="flex-shrink-0 text-[length:var(--text-3)] text-[var(--text-muted)]">
                  {formatRelativeTime(driver.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Panel title="Shortages">
          {shortages.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">Every active destination is fully staffed.</p>
          )}
          <div className="flex flex-col gap-2">
            {shortages.map((s) => (
              <div
                key={s.requirementId}
                onClick={() => onNavigate('ships')}
                className="cursor-pointer rounded-lg border border-[var(--surface-muted)] px-3 py-2 transition hover:bg-[var(--surface-page-1)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">
                    {s.shipName} · {s.destination}
                  </span>
                  <span className="flex-shrink-0 rounded-full bg-[var(--warning-bg)] px-2 py-0.5 text-[length:var(--text-2)] font-semibold text-[var(--warning)]">
                    {s.confirmedCount}/{s.quantityNeeded} confirmed
                  </span>
                </div>
                {s.pendingCount > 0 && (
                  <div className="mt-0.5 text-[length:var(--text-4)] text-[var(--text-muted)]">
                    {s.pendingCount} pending outreach
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Yellow Zone">
          {(yellowZoneStats?.PENDING ?? 0) === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Good — nothing needs your attention.</p>
          ) : (
            <>
              <div
                onClick={() => onNavigate('yellow-zone')}
                className="mb-2 cursor-pointer text-[length:var(--text-4)] font-semibold text-[var(--danger)] hover:underline"
              >
                {yellowZoneStats?.PENDING} automated{' '}
                {yellowZoneStats?.PENDING === 1 ? 'call needs' : 'calls need'} review →
              </div>
              <div className="flex flex-col gap-2">
                {pendingYellowZone?.items.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => onNavigate('yellow-zone')}
                    className="cursor-pointer rounded-lg border border-[var(--surface-muted)] px-3 py-2 transition hover:bg-[var(--surface-page-1)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">
                        {item.driverName} · {item.shipName}
                      </span>
                      <span
                        className="flex-shrink-0 rounded-full px-2 py-0.5 text-[length:var(--text-2)] font-semibold"
                        style={{
                          background: YELLOW_ZONE_PRIORITY_STYLE[item.priority].bg,
                          color: YELLOW_ZONE_PRIORITY_STYLE[item.priority].color,
                        }}
                      >
                        {item.priority}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[length:var(--text-4)] text-[var(--text-muted)]">{item.reason}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>

        <Panel title="Today's operations">
          {today.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">Nothing scheduled to arrive or report today.</p>
          )}
          <div className="flex flex-col gap-2">
            {today.map((ship) => (
              <div
                key={ship.id}
                onClick={() => onNavigate('ships')}
                className="cursor-pointer rounded-lg border border-[var(--surface-muted)] px-3 py-2 transition hover:bg-[var(--surface-page-1)]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">
                    {ship.shipName}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[length:var(--text-2)] font-semibold"
                    style={{
                      background: SHIP_STATUS_STYLE[ship.status].bg,
                      color: SHIP_STATUS_STYLE[ship.status].color,
                    }}
                  >
                    {SHIP_STATUS_LABEL[ship.status]}
                  </span>
                </div>
                <div className="mt-0.5 text-[length:var(--text-4)] text-[var(--text-muted)]">
                  {ship.eta && `ETA ${formatDateTime(ship.eta)}`}
                  {ship.eta && ship.reportingTime && ' · '}
                  {ship.reportingTime && `Reporting ${formatDateTime(ship.reportingTime)}`}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Quick actions">
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onNavigate('ships', true)}
              className="rounded-full bg-[var(--accent)] px-4 py-2.5 text-left text-[length:var(--text-7)] font-semibold text-white hover:bg-[var(--accent-hover)]"
            >
              + Create ship operation
            </button>
            <button
              onClick={() => onNavigate('drivers', true)}
              className="rounded-full border border-[var(--border)] bg-[var(--surface-card)] px-4 py-2.5 text-left text-[length:var(--text-7)] font-semibold text-[var(--accent)] hover:bg-[var(--surface-page-1)]"
            >
              + Add driver
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--surface-muted)] pt-3">
            <MiniStat
              label="Confirmed drivers"
              value={driverStats.CONFIRMED}
              style={AVAILABILITY_STYLE.CONFIRMED}
              labelOverride={AVAILABILITY_LABEL.CONFIRMED}
            />
            <MiniStat
              label="Escalated"
              value={driverStats.ESCALATED}
              style={AVAILABILITY_STYLE.ESCALATED}
              labelOverride={AVAILABILITY_LABEL.ESCALATED}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4.5">
      <h3 className="mb-3 text-[length:var(--text-4)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {title}
      </h3>
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  loading,
  onClick,
}: {
  label: string;
  value: number;
  tone: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="text-[length:var(--text-2)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      {loading ? (
        <div className="mt-2 h-6 w-10 animate-pulse rounded bg-[var(--surface-muted-3)]" />
      ) : (
        <div className="mt-1 font-mono text-2xl font-bold" style={{ color: tone }}>
          {value}
        </div>
      )}
    </button>
  );
}

function MiniStat({
  value,
  style,
  labelOverride,
}: {
  label: string;
  value: number;
  style: { bg: string; color: string };
  labelOverride: string;
}) {
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: style.bg }}>
      <div className="text-[length:var(--text-2)] font-semibold" style={{ color: style.color }}>
        {labelOverride}
      </div>
      <div className="text-sm font-bold" style={{ color: style.color }}>
        {value}
      </div>
    </div>
  );
}
