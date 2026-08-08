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

  return (
    <div className="animate-[tideIn_0.2s_ease]">
      <div className="mb-5">
        <h1 className="text-lg font-bold text-[#0F2A38]">Dashboard</h1>
        <p className="mt-0.5 text-xs text-[#8B9AA3]">What needs your attention right now.</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard
          label="Recruiting"
          value={shipStats.RECRUITING}
          tone="#B4762A"
          loading={isLoading}
        />
        <StatCard
          label="In Progress"
          value={shipStats.IN_PROGRESS}
          tone="#2A5DA6"
          loading={isLoading}
        />
        <StatCard
          label="Drivers idle"
          value={driverStats.IDLE}
          tone="#8B9AA3"
          loading={isLoading}
        />
        <StatCard
          label="Drivers on call"
          value={driverStats.ON_CALL}
          tone="#B4762A"
          loading={isLoading}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Panel title="Shortages">
          {shortages.length === 0 && (
            <p className="text-xs text-[#8B9AA3]">Every active destination is fully staffed.</p>
          )}
          <div className="flex flex-col gap-2">
            {shortages.map((s) => (
              <div
                key={s.requirementId}
                onClick={() => onNavigate('ships')}
                className="cursor-pointer rounded-lg border border-[#F5EEE0] px-3 py-2 transition hover:bg-[#FBF6EE]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-semibold text-[#0F2A38]">
                    {s.shipName} · {s.destination}
                  </span>
                  <span className="flex-shrink-0 rounded-full bg-[#FDEFD9] px-2 py-0.5 text-[10px] font-semibold text-[#B4762A]">
                    {s.confirmedCount}/{s.quantityNeeded} confirmed
                  </span>
                </div>
                {s.pendingCount > 0 && (
                  <div className="mt-0.5 text-[11px] text-[#8B9AA3]">
                    {s.pendingCount} pending outreach
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Yellow Zone">
          {(yellowZoneStats?.PENDING ?? 0) === 0 ? (
            <p className="text-xs text-[#8B9AA3]">Good — nothing needs your attention.</p>
          ) : (
            <>
              <div
                onClick={() => onNavigate('yellow-zone')}
                className="mb-2 cursor-pointer text-[11px] font-semibold text-[#C1503B] hover:underline"
              >
                {yellowZoneStats?.PENDING} automated{' '}
                {yellowZoneStats?.PENDING === 1 ? 'call needs' : 'calls need'} review →
              </div>
              <div className="flex flex-col gap-2">
                {pendingYellowZone?.items.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => onNavigate('yellow-zone')}
                    className="cursor-pointer rounded-lg border border-[#F5EEE0] px-3 py-2 transition hover:bg-[#FBF6EE]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] font-semibold text-[#0F2A38]">
                        {item.driverName} · {item.shipName}
                      </span>
                      <span
                        className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{
                          background: YELLOW_ZONE_PRIORITY_STYLE[item.priority].bg,
                          color: YELLOW_ZONE_PRIORITY_STYLE[item.priority].color,
                        }}
                      >
                        {item.priority}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[#8B9AA3]">{item.reason}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>

        <Panel title="Today's operations">
          {today.length === 0 && (
            <p className="text-xs text-[#8B9AA3]">Nothing scheduled to arrive or report today.</p>
          )}
          <div className="flex flex-col gap-2">
            {today.map((ship) => (
              <div
                key={ship.id}
                onClick={() => onNavigate('ships')}
                className="cursor-pointer rounded-lg border border-[#F5EEE0] px-3 py-2 transition hover:bg-[#FBF6EE]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold text-[#0F2A38]">
                    {ship.shipName}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      background: SHIP_STATUS_STYLE[ship.status].bg,
                      color: SHIP_STATUS_STYLE[ship.status].color,
                    }}
                  >
                    {SHIP_STATUS_LABEL[ship.status]}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-[#8B9AA3]">
                  {ship.eta && `ETA ${formatDateTime(ship.eta)}`}
                  {ship.eta && ship.reportingTime && ' · '}
                  {ship.reportingTime && `Reporting ${formatDateTime(ship.reportingTime)}`}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Upcoming ETAs">
          {upcoming.length === 0 && (
            <p className="text-xs text-[#8B9AA3]">No ships with a scheduled ETA yet.</p>
          )}
          <div className="flex flex-col gap-2">
            {upcoming.map((ship) => (
              <div
                key={ship.id}
                onClick={() => onNavigate('ships')}
                className="flex cursor-pointer items-center justify-between rounded-lg border border-[#F5EEE0] px-3 py-2 transition hover:bg-[#FBF6EE]"
              >
                <span className="text-[12.5px] font-semibold text-[#0F2A38]">{ship.shipName}</span>
                <span className="text-[11px] text-[#8B9AA3]">{formatDateTime(ship.eta)}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recently updated">
          {(recentShips?.items.length ?? 0) === 0 && (recentDrivers?.items.length ?? 0) === 0 && (
            <p className="text-xs text-[#8B9AA3]">No activity yet.</p>
          )}
          <div className="flex flex-col gap-2">
            {recentShips?.items.slice(0, 3).map((ship) => (
              <div
                key={ship.id}
                onClick={() => onNavigate('ships')}
                className="flex cursor-pointer items-center justify-between rounded-lg border border-[#F5EEE0] px-3 py-2 transition hover:bg-[#FBF6EE]"
              >
                <span className="text-[12.5px] text-[#0F2A38]">
                  Ship <span className="font-semibold">{ship.shipName}</span>
                </span>
                <span className="text-[11px] text-[#8B9AA3]">
                  {formatRelativeTime(ship.updatedAt)}
                </span>
              </div>
            ))}
            {recentDrivers?.items.slice(0, 3).map((driver) => (
              <div
                key={driver.id}
                onClick={() => onNavigate('drivers')}
                className="flex cursor-pointer items-center justify-between rounded-lg border border-[#F5EEE0] px-3 py-2 transition hover:bg-[#FBF6EE]"
              >
                <span className="text-[12.5px] text-[#0F2A38]">
                  Driver <span className="font-semibold">{driver.fullName}</span>
                </span>
                <span className="text-[11px] text-[#8B9AA3]">
                  {formatRelativeTime(driver.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Quick actions">
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onNavigate('ships', true)}
              className="rounded-lg bg-[#1E7A8C] px-4 py-2.5 text-left text-[12.5px] font-semibold text-white hover:bg-[#175F6E]"
            >
              + Create ship operation
            </button>
            <button
              onClick={() => onNavigate('drivers', true)}
              className="rounded-lg border border-[#ECE1CC] bg-white px-4 py-2.5 text-left text-[12.5px] font-semibold text-[#1E7A8C] hover:bg-[#FBF6EE]"
            >
              + Add driver
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#F5EEE0] pt-3">
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
    <div className="rounded-2xl border border-[#ECE1CC] bg-white p-4.5">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#8B9AA3]">
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
}: {
  label: string;
  value: number;
  tone: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#ECE1CC] bg-white px-3.5 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8B9AA3]">
        {label}
      </div>
      {loading ? (
        <div className="mt-1.5 h-5 w-8 animate-pulse rounded bg-[#F0EADC]" />
      ) : (
        <div className="mt-0.5 text-lg font-bold" style={{ color: tone }}>
          {value}
        </div>
      )}
    </div>
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
      <div className="text-[10px] font-semibold" style={{ color: style.color }}>
        {labelOverride}
      </div>
      <div className="text-sm font-bold" style={{ color: style.color }}>
        {value}
      </div>
    </div>
  );
}
