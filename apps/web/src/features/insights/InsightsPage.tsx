import type { InsightDto } from '@kinvo/contracts';
import { useInsightsSummary } from './useInsights';

// Phase E (Kinvo UI redesign, Intelligence group) — the last piece,
// deliberately built only after Timeline/Transcripts/Analytics existed
// to observe. The nav label is "Insights," not "AI Insights" as in the
// Kinvo.dc.html mockup — every observation below is a rule-based pattern
// computed directly from real Assignment/YellowZoneItem/
// AssignmentAttempt rows, not an LLM call, and the page says so plainly
// rather than letting the label overclaim what's actually happening
// (see insights.schema.ts's own comment for the full reasoning).
export function InsightsPage() {
  const { data, isLoading, isError } = useInsightsSummary(30);

  return (
    <div className="animate-[tideIn_0.2s_ease] max-w-[640px]">
      <p className="mb-3.5 text-[length:var(--text-5)] text-[var(--text-muted)]">
        Rule-based patterns computed directly from real activity over the last 30 days — not
        AI-generated. Each one only appears once there's enough real data behind it to be a
        pattern, not noise from a single event.
      </p>

      {isLoading && <InsightsSkeleton />}
      {isError && <p className="text-sm text-[var(--danger)]">Could not load insights.</p>}

      {!isLoading && !isError && data && data.insights.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] py-10 text-center">
          <div className="mb-1 text-[length:var(--text-10)] font-semibold text-[var(--text-strong)]">
            Nothing stands out yet
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Not enough activity in the last 30 days to surface a real pattern — this is an honest
            empty state, not a placeholder.
          </p>
        </div>
      )}

      {!isLoading && data && data.insights.length > 0 && (
        <div className="flex flex-col gap-3">
          {data.insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </div>
      )}
    </div>
  );
}

function InsightCard({ insight }: { insight: InsightDto }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <div className="text-[length:var(--text-3)] font-semibold uppercase tracking-wide text-[var(--accent)]">
        {insight.title}
      </div>
      <p className="mt-2 text-[length:var(--text-8)] text-[var(--text-strong)]">{insight.observation}</p>
      <p className="mt-2.5 rounded-xl bg-[var(--surface-card-alt)] p-3 text-[length:var(--text-6)] text-[var(--text-secondary)]">
        {insight.recommendation}
      </p>
      <p className="mt-2.5 text-[length:var(--text-2)] text-[var(--text-muted)]">{insight.basis}</p>
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1].map((i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
          <div className="h-2.5 w-1/4 rounded bg-[var(--surface-muted-2)]" />
          <div className="mt-3 h-3.5 w-full rounded bg-[var(--surface-muted-3)]" />
          <div className="mt-2 h-3.5 w-2/3 rounded bg-[var(--surface-muted-3)]" />
        </div>
      ))}
    </div>
  );
}
