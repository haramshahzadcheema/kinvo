import type { AnalyticsStatDto, DailyCallVolumeDto, YellowZonePriorityBreakdownDto } from '@kinvo/contracts';
import { YELLOW_ZONE_PRIORITY_LABEL, YELLOW_ZONE_PRIORITY_STYLE } from '../yellow-zone/statusStyles';
import { useAnalyticsSummary } from './useAnalytics';

const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;
const CHART_PAD = 10;

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

// Phase E (Kinvo UI redesign, Intelligence group): every number on this
// page is a real aggregate over AssignmentAttempt/VoiceCallPlacement/
// YellowZoneItem rows — nothing estimated. Two stats from the
// Kinvo.dc.html mockup are deliberately absent ("Supervisor Hours
// Saved," "Avg Replacement Time") and "Yellow Zone by Category" became
// "Yellow Zone by Priority" — see analytics.schema.ts's own comment for
// why each one isn't honestly derivable from data this codebase has.
export function AnalyticsPage() {
  const { data, isLoading, isError } = useAnalyticsSummary(7);

  if (isLoading) {
    return <AnalyticsSkeleton />;
  }

  if (isError || !data) {
    return <p className="text-sm text-[var(--danger)]">Could not load analytics.</p>;
  }

  return (
    <div className="animate-[tideIn_0.2s_ease]">
      <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {data.stats.map((stat) => (
          <StatCard key={stat.key} stat={stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.5fr_1fr]">
        <CallsChart dailyCallVolume={data.dailyCallVolume} />
        <YellowZoneByPriority breakdown={data.yellowZoneByPriority} />
      </div>
    </div>
  );
}

function StatCard({ stat }: { stat: AnalyticsStatDto }) {
  const max = Math.max(1, ...stat.spark);
  const up = stat.deltaPct !== null && stat.deltaPct >= 0;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[length:var(--text-2)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {stat.label}
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-[var(--text-strong)]">{stat.value}</div>
          {stat.deltaPct !== null && (
            <div
              className="mt-1.5 text-[length:var(--text-2)]"
              style={{ color: up ? 'var(--success)' : 'var(--warning)' }}
            >
              {up ? '+' : ''}
              {stat.deltaPct.toFixed(0)}% vs prior period
            </div>
          )}
        </div>
        <div className="flex h-9 flex-shrink-0 items-end gap-[3px]">
          {stat.spark.map((value, i) => (
            <span
              key={i}
              className="block w-[3.5px] rounded-sm"
              style={{
                height: `${Math.max(6, (value / max) * 100)}%`,
                background: 'var(--accent)',
                opacity: 0.35 + 0.65 * (i / Math.max(1, stat.spark.length - 1)),
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CallsChart({ dailyCallVolume }: { dailyCallVolume: DailyCallVolumeDto[] }) {
  const max = Math.max(1, ...dailyCallVolume.map((d) => d.automated + d.escalated));
  const stepX =
    dailyCallVolume.length > 1 ? (CHART_WIDTH - CHART_PAD * 2) / (dailyCallVolume.length - 1) : 0;
  const yFor = (v: number) => CHART_HEIGHT - CHART_PAD - (v / max) * (CHART_HEIGHT - CHART_PAD * 2);
  const xFor = (i: number) => CHART_PAD + i * stepX;

  const automatedPts = dailyCallVolume.map((d, i) => `${xFor(i)},${yFor(d.automated)}`).join(' ');
  const escalatedPts = dailyCallVolume.map((d, i) => `${xFor(i)},${yFor(d.escalated)}`).join(' ');
  const automatedArea = `${CHART_PAD},${CHART_HEIGHT - CHART_PAD} ${automatedPts} ${xFor(dailyCallVolume.length - 1)},${CHART_HEIGHT - CHART_PAD}`;

  const hasAnyData = dailyCallVolume.some((d) => d.automated + d.escalated > 0);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5.5">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[length:var(--text-8)] font-semibold text-[var(--text-strong)]">Calls This Week</div>
        <div className="flex gap-3.5 text-[length:var(--text-2)] text-[var(--text-muted)]">
          <span>
            <span
              className="mr-1 inline-block h-2 w-2 rounded-full"
              style={{ background: 'var(--accent)' }}
            />
            Automated
          </span>
          <span>
            <span
              className="mr-1 inline-block h-2 w-2 rounded-full"
              style={{ background: 'var(--danger)' }}
            />
            Escalated
          </span>
        </div>
      </div>
      {hasAnyData ? (
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT + 16}`} className="w-full" style={{ height: 170 }}>
          <polygon points={automatedArea} fill="var(--accent)" opacity={0.1} />
          <polyline
            points={automatedPts}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <polyline
            points={escalatedPts}
            fill="none"
            stroke="var(--danger)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray="4 4"
          />
          {dailyCallVolume.map((d, i) => (
            <text
              key={d.date}
              x={xFor(i)}
              y={CHART_HEIGHT + 14}
              fontSize={10}
              fill="var(--text-muted)"
              textAnchor="middle"
            >
              {formatShortDate(d.date)}
            </text>
          ))}
        </svg>
      ) : (
        <div className="flex h-[170px] items-center justify-center text-[length:var(--text-5)] text-[var(--text-muted)]">
          No automated calls in this period yet.
        </div>
      )}
    </div>
  );
}

function YellowZoneByPriority({ breakdown }: { breakdown: YellowZonePriorityBreakdownDto[] }) {
  const max = Math.max(1, ...breakdown.map((b) => b.count));
  const total = breakdown.reduce((sum, b) => sum + b.count, 0);
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5.5">
      <div className="mb-4 text-[length:var(--text-8)] font-semibold text-[var(--text-strong)]">
        Yellow Zone by Priority
      </div>
      {total === 0 ? (
        <p className="text-[length:var(--text-5)] text-[var(--text-muted)]">
          No escalations in this period.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {breakdown.map((b) => (
            <div key={b.priority}>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[length:var(--text-5)] text-[var(--text-secondary)]">
                <span>{YELLOW_ZONE_PRIORITY_LABEL[b.priority]}</span>
                <span className="font-mono text-[var(--text-muted)]">{b.count}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted-2)]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(b.count / max) * 100}%`,
                    background: YELLOW_ZONE_PRIORITY_STYLE[b.priority].color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div>
      <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
            <div className="h-2.5 w-2/3 rounded bg-[var(--surface-muted-2)]" />
            <div className="mt-3 h-6 w-1/2 rounded bg-[var(--surface-muted-3)]" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.5fr_1fr]">
        <div className="h-[210px] animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface-card)]" />
        <div className="h-[210px] animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface-card)]" />
      </div>
    </div>
  );
}
