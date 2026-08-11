import type { InsightDto, InsightsSummaryDto, InsightsSummaryQuery } from '@kinvo/contracts';
import type { prisma as prismaClient } from '../../core/prisma';
import { getRequestContext } from '../../core/request-context';

export interface InsightsServiceDependencies {
  prisma: typeof prismaClient;
}

export interface InsightsService {
  getSummary(query: InsightsSummaryQuery): Promise<InsightsSummaryDto>;
}

const NEGATIVE_ASSIGNMENT_STATUSES = ['REJECTED', 'CANCELLED', 'NO_SHOW'] as const;

// A driver needs at least this many negative outcomes to be called a
// pattern, not one bad day — and must be a CLEAR outlier (strictly more
// than the runner-up), since a tie among several drivers with one each
// isn't a real signal either.
const MIN_DRIVER_NEGATIVE_OUTCOMES = 2;

// Yellow Zone escalations need a real sample before an hourly
// distribution means anything.
const MIN_ESCALATION_SAMPLE = 5;
// A uniform spread across 24 hours puts each hour at ~4.2% — the peak
// hour must carry meaningfully more than that (roughly 3x) before this
// calls it a real pattern rather than noise.
const MIN_ESCALATION_PEAK_SHARE = 0.125;

// Deliberately a small, fixed, literal keyword list — not semantic
// understanding, not an LLM call. See insights.schema.ts's own comment
// for why: the mockup's "AI Insights" implied genuine LLM-generated
// analysis, which would mean a new external API dependency and sending
// driver call transcripts to a third party — a decision explicitly
// deferred, not assumed. This is the honest alternative: real counting
// over real transcript text CALL-E's API already returns (see
// core/voice/outcomeTranslation.ts's extractTranscript).
const KEYWORD_THEMES: readonly { label: string; keywords: readonly string[] }[] = [
  { label: 'payment or rate', keywords: ['payment', 'pay', 'paid', 'money', 'rate', 'salary'] },
  { label: 'documents', keywords: ['document', 'license', 'permit', 'paper', 'id card'] },
  { label: 'schedule or timing', keywords: ['schedule', 'late', 'early', 'report', 'reporting', 'time'] },
  { label: 'vehicle or truck', keywords: ['truck', 'vehicle', 'flatbed', 'container', 'trailer'] },
];
const MIN_KEYWORD_MATCHES = 3;

interface TranscriptTurnLike {
  speaker?: string;
  text?: string;
}

export function createInsightsService({ prisma }: InsightsServiceDependencies): InsightsService {
  async function computeDriverReliabilityInsight(
    organizationId: string,
    windowStart: Date,
    days: number,
  ): Promise<InsightDto | null> {
    // Assignment.updatedAt is set by every one of the reject/cancel/
    // no-show transitions (each goes through a Prisma update()) — a
    // reliable proxy for "when this assignment reached this negative
    // status," without needing to pick between three different
    // status-specific timestamp columns (respondedAt/cancelledAt/
    // noShowAt) that don't share one name.
    const negative = await prisma.assignment.groupBy({
      by: ['driverId'],
      where: {
        organizationId,
        status: { in: [...NEGATIVE_ASSIGNMENT_STATUSES] },
        updatedAt: { gte: windowStart },
      },
      _count: { _all: true },
    });
    if (negative.length === 0) return null;

    const sorted = [...negative].sort((a, b) => b._count._all - a._count._all);
    const top = sorted[0]!;
    if (top._count._all < MIN_DRIVER_NEGATIVE_OUTCOMES) return null;
    if (sorted.length > 1 && sorted[1]!._count._all === top._count._all) return null;

    const driver = await prisma.driver.findUnique({
      where: { id: top.driverId },
      select: { fullName: true },
    });
    if (!driver) return null;

    const totalNegative = negative.reduce((sum, d) => sum + d._count._all, 0);
    return {
      id: 'driver_reliability',
      title: 'Driver Reliability',
      observation: `${driver.fullName} has ${top._count._all} rejected, cancelled, or no-show assignments in the last ${days} days — the most of any driver.`,
      recommendation: `Consider avoiding ${driver.fullName} for urgent or time-critical loads until this trend improves.`,
      basis: `Based on ${totalNegative} negative assignment outcome${totalNegative === 1 ? '' : 's'} across ${negative.length} driver${negative.length === 1 ? '' : 's'} in the period.`,
    };
  }

  async function computeEscalationTimingInsight(
    organizationId: string,
    windowStart: Date,
    days: number,
  ): Promise<InsightDto | null> {
    // YellowZoneItem is tenant-scoped via the Prisma extension —
    // organizationId is injected automatically, matching every other
    // direct query against it elsewhere in this codebase.
    const items = await prisma.yellowZoneItem.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { createdAt: true },
    });
    if (items.length < MIN_ESCALATION_SAMPLE) return null;

    const hourCounts = new Array(24).fill(0) as number[];
    for (const item of items) {
      const hour = item.createdAt.getUTCHours();
      hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
    }
    const peakCount = Math.max(...hourCounts);
    const peakHour = hourCounts.indexOf(peakCount);
    const share = peakCount / items.length;
    if (share < MIN_ESCALATION_PEAK_SHARE) return null;

    const rangeLabel = `${String(peakHour).padStart(2, '0')}:00–${String((peakHour + 1) % 24).padStart(2, '0')}:00 UTC`;
    return {
      id: 'escalation_timing',
      title: 'Escalation Timing',
      observation: `${Math.round(share * 100)}% of Yellow Zone escalations in the last ${days} days happened between ${rangeLabel} (${peakCount} of ${items.length}).`,
      recommendation: `Consider extra supervisor coverage during ${rangeLabel}.`,
      basis: `Based on ${items.length} escalations in the period.`,
    };
  }

  async function computeTranscriptKeywordInsight(
    organizationId: string,
    windowStart: Date,
    days: number,
  ): Promise<InsightDto | null> {
    // AssignmentAttempt is deliberately not tenant-scoped (see
    // core/prisma.ts) — organizationId filtered explicitly through the
    // owning Assignment, same as voice.service.ts's own listCalls query.
    const attempts = await prisma.assignmentAttempt.findMany({
      where: {
        provider: { not: null },
        assignment: { organizationId },
        attemptedAt: { gte: windowStart },
      },
      select: { transcriptTurns: true },
    });

    const themeCounts = new Map<string, number>();
    let totalUserTurns = 0;
    let transcribedCalls = 0;
    for (const attempt of attempts) {
      const turns = attempt.transcriptTurns;
      if (!Array.isArray(turns) || turns.length === 0) continue;
      transcribedCalls += 1;
      for (const rawTurn of turns) {
        const turn = rawTurn as TranscriptTurnLike;
        if (turn?.speaker !== 'user' || typeof turn.text !== 'string') continue;
        totalUserTurns += 1;
        const lower = turn.text.toLowerCase();
        for (const theme of KEYWORD_THEMES) {
          if (theme.keywords.some((kw) => lower.includes(kw))) {
            themeCounts.set(theme.label, (themeCounts.get(theme.label) ?? 0) + 1);
          }
        }
      }
    }
    if (themeCounts.size === 0) return null;

    const [topLabel, topCount] = [...themeCounts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    if (topCount < MIN_KEYWORD_MATCHES) return null;

    return {
      id: 'transcript_keywords',
      title: 'Common Driver Questions',
      observation: `${topCount} driver responses in the last ${days} days mentioned ${topLabel} — more than any other tracked topic.`,
      recommendation: `Consider a proactive message covering ${topLabel} to reduce repeat questions.`,
      basis: `A fixed keyword match (not semantic understanding) across ${totalUserTurns} real driver responses in ${transcribedCalls} transcribed call${transcribedCalls === 1 ? '' : 's'}.`,
    };
  }

  async function getSummary(query: InsightsSummaryQuery): Promise<InsightsSummaryDto> {
    const context = getRequestContext();
    const windowStart = new Date(Date.now() - query.days * 86_400_000);

    const [driverInsight, timingInsight, keywordInsight] = await Promise.all([
      computeDriverReliabilityInsight(context.organizationId, windowStart, query.days),
      computeEscalationTimingInsight(context.organizationId, windowStart, query.days),
      computeTranscriptKeywordInsight(context.organizationId, windowStart, query.days),
    ]);

    return {
      days: query.days,
      insights: [driverInsight, timingInsight, keywordInsight].filter(
        (insight): insight is InsightDto => insight !== null,
      ),
    };
  }

  return { getSummary };
}
