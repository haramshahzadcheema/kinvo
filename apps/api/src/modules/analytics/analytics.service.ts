import type { AnalyticsStatDto, AnalyticsSummaryDto, AnalyticsSummaryQuery } from '@kinvo/contracts';
import type { prisma as prismaClient } from '../../core/prisma';
import { getRequestContext } from '../../core/request-context';

export interface AnalyticsServiceDependencies {
  prisma: typeof prismaClient;
}

export interface AnalyticsService {
  getSummary(query: AnalyticsSummaryQuery): Promise<AnalyticsSummaryDto>;
}

const RESOLVED_OUTCOMES = ['CONFIRMED', 'REJECTED', 'UNREACHABLE'] as const;

export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addUTCDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// Every day string in [start, end), oldest first — the scaffold every
// daily bucket gets filled onto, so a day with zero events shows up as a
// real 0 in the series rather than silently disappearing from it. Both
// bounds must already be UTC day boundaries (see getSummary) — a
// non-truncated `end` (e.g. "now" mid-day) would exclude today's own
// bucket, since `cursor < end` never reaches a `cursor` timestamped at
// midnight when `end` is later the same day.
export function dayRange(start: Date, end: Date): string[] {
  const days: string[] = [];
  let cursor = start;
  while (cursor < end) {
    days.push(dateKey(cursor));
    cursor = addUTCDays(cursor, 1);
  }
  return days;
}

// null (not 0%, not Infinity) when the prior window has nothing to
// compare against — "no prior data" is not the same fact as "no change,"
// and a from-zero increase has no finite percentage.
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function formatSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return '—';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function createAnalyticsService({ prisma }: AnalyticsServiceDependencies): AnalyticsService {
  async function getSummary(query: AnalyticsSummaryQuery): Promise<AnalyticsSummaryDto> {
    const context = getRequestContext();
    // Whole UTC calendar days throughout, not a rolling N*24h window
    // ending at the exact current millisecond — that would make "today"
    // a partial day, requiring the day-bucket boundaries to disagree
    // with the DB filter boundaries (see dayRange's own comment for what
    // goes wrong when they don't match). windowEnd is the start of
    // TOMORROW so that all of today is included; windowStart is
    // query.days calendar days before that, so the range is exactly
    // query.days full days, always ending with today.
    const todayStart = startOfUTCDay(new Date());
    const windowEnd = addUTCDays(todayStart, 1);
    const windowStart = addUTCDays(windowEnd, -query.days);
    const priorWindowStart = addUTCDays(windowStart, -query.days);

    const days = dayRange(windowStart, windowEnd);

    // Every AssignmentAttempt/VoiceCallPlacement query here spans BOTH the
    // current and prior comparison window in one round trip, then splits
    // in memory — AssignmentAttempt/VoiceCallPlacement are deliberately
    // not tenant-scoped (see core/prisma.ts), so organizationId is
    // filtered explicitly through the owning Assignment, same as
    // voice.service.ts's own listCalls query.
    const attempts = await prisma.assignmentAttempt.findMany({
      where: {
        provider: { not: null },
        assignment: { organizationId: context.organizationId },
        attemptedAt: { gte: priorWindowStart, lt: windowEnd },
      },
      select: { outcome: true, attemptedAt: true },
    });
    const currentAttempts = attempts.filter((a) => a.attemptedAt >= windowStart);
    const priorAttempts = attempts.filter((a) => a.attemptedAt < windowStart);

    const placements = await prisma.voiceCallPlacement.findMany({
      where: {
        resolvedAt: { not: null, gte: priorWindowStart, lt: windowEnd },
        assignment: { organizationId: context.organizationId },
      },
      select: { placedAt: true, resolvedAt: true },
    });
    const durationSeconds = (p: { placedAt: Date; resolvedAt: Date | null }) =>
      ((p.resolvedAt as Date).getTime() - p.placedAt.getTime()) / 1000;
    const currentPlacements = placements.filter((p) => (p.resolvedAt as Date) >= windowStart);
    const priorPlacements = placements.filter((p) => (p.resolvedAt as Date) < windowStart);

    // YellowZoneItem IS tenant-scoped (the Prisma extension injects
    // organizationId automatically), unlike the two queries above.
    const yellowZoneItems = await prisma.yellowZoneItem.findMany({
      where: { createdAt: { gte: priorWindowStart, lt: windowEnd } },
      select: { priority: true, createdAt: true },
    });
    const currentYellowZone = yellowZoneItems.filter((y) => y.createdAt >= windowStart);
    const priorYellowZone = yellowZoneItems.filter((y) => y.createdAt < windowStart);

    // --- Daily call volume + "Calls Automated" / "Resolution Rate" ---
    const dailyTotals = new Map<string, { automated: number; escalated: number }>();
    for (const day of days) dailyTotals.set(day, { automated: 0, escalated: 0 });
    for (const attempt of currentAttempts) {
      const bucket = dailyTotals.get(dateKey(attempt.attemptedAt));
      if (!bucket) continue;
      if (attempt.outcome === 'SYSTEM_ERROR') bucket.escalated += 1;
      else bucket.automated += 1;
    }
    const dailyCallVolume = days.map((date) => ({ date, ...dailyTotals.get(date)! }));

    const currentTotalCalls = currentAttempts.length;
    const priorTotalCalls = priorAttempts.length;
    const callsAutomatedSpark = days.map((date) => {
      const bucket = dailyTotals.get(date)!;
      return bucket.automated + bucket.escalated;
    });

    const currentResolved = currentAttempts.filter((a) =>
      (RESOLVED_OUTCOMES as readonly string[]).includes(a.outcome),
    ).length;
    const priorResolved = priorAttempts.filter((a) =>
      (RESOLVED_OUTCOMES as readonly string[]).includes(a.outcome),
    ).length;
    const currentResolutionRate = currentTotalCalls === 0 ? 0 : (currentResolved / currentTotalCalls) * 100;
    const priorResolutionRate = priorTotalCalls === 0 ? 0 : (priorResolved / priorTotalCalls) * 100;
    const resolutionRateSpark = days.map((date) => {
      const bucket = dailyTotals.get(date)!;
      const total = bucket.automated + bucket.escalated;
      // automated already excludes SYSTEM_ERROR (see the bucketing loop
      // above), so it IS the resolved count for that day.
      return total === 0 ? 0 : (bucket.automated / total) * 100;
    });

    // --- "Avg Time to Resolve" ---
    const currentAvgResolveSeconds =
      currentPlacements.length === 0
        ? 0
        : currentPlacements.reduce((sum, p) => sum + durationSeconds(p), 0) / currentPlacements.length;
    const priorAvgResolveSeconds =
      priorPlacements.length === 0
        ? 0
        : priorPlacements.reduce((sum, p) => sum + durationSeconds(p), 0) / priorPlacements.length;
    const resolveDailyBuckets = new Map<string, number[]>();
    for (const day of days) resolveDailyBuckets.set(day, []);
    for (const p of currentPlacements) {
      const bucket = resolveDailyBuckets.get(dateKey(p.resolvedAt as Date));
      if (bucket) bucket.push(durationSeconds(p));
    }
    const avgResolveSpark = days.map((date) => {
      const values = resolveDailyBuckets.get(date)!;
      return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
    });

    // --- "Yellow Zone Escalations" + by-priority breakdown ---
    const yellowZoneDailyCounts = new Map<string, number>();
    for (const day of days) yellowZoneDailyCounts.set(day, 0);
    for (const item of currentYellowZone) {
      const key = dateKey(item.createdAt);
      yellowZoneDailyCounts.set(key, (yellowZoneDailyCounts.get(key) ?? 0) + 1);
    }
    const yellowZoneSpark = days.map((date) => yellowZoneDailyCounts.get(date) ?? 0);

    const priorityOrder = ['HIGH', 'MEDIUM', 'LOW'] as const;
    const yellowZoneByPriority = priorityOrder.map((priority) => ({
      priority,
      count: currentYellowZone.filter((y) => y.priority === priority).length,
    }));

    const stats: AnalyticsStatDto[] = [
      {
        key: 'calls_automated',
        label: 'Calls Automated',
        value: `${currentTotalCalls}`,
        spark: callsAutomatedSpark,
        deltaPct: deltaPct(currentTotalCalls, priorTotalCalls),
      },
      {
        key: 'resolution_rate',
        label: 'Resolution Rate',
        value: `${currentResolutionRate.toFixed(0)}%`,
        spark: resolutionRateSpark,
        deltaPct: deltaPct(currentResolutionRate, priorResolutionRate),
      },
      {
        key: 'avg_time_to_resolve',
        label: 'Avg Time to Resolve',
        value: formatSeconds(currentAvgResolveSeconds),
        spark: avgResolveSpark,
        deltaPct: deltaPct(currentAvgResolveSeconds, priorAvgResolveSeconds),
      },
      {
        key: 'yellow_zone_escalations',
        label: 'Yellow Zone Escalations',
        value: `${currentYellowZone.length}`,
        spark: yellowZoneSpark,
        deltaPct: deltaPct(currentYellowZone.length, priorYellowZone.length),
      },
    ];

    return {
      days: query.days,
      stats,
      dailyCallVolume,
      yellowZoneByPriority,
    };
  }

  return { getSummary };
}
