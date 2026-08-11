import { z } from 'zod';

// Phase E (Kinvo UI redesign, Intelligence group) — the last piece,
// deliberately built only after Timeline/Transcripts/Analytics existed
// to observe. Every insight here is a RULE-BASED pattern computed
// directly from real rows (Assignment, YellowZoneItem,
// AssignmentAttempt.transcriptTurns) — there is no LLM call anywhere in
// this pipeline. The mockup's "AI Insights" implied genuine
// LLM-generated summaries; that would mean a new external API
// dependency, real per-call cost, and sending driver call transcripts to
// a third party — a product/privacy decision, not just an engineering
// one, so it was explicitly deferred rather than assumed. Each insight
// only appears when there's enough real data behind it to be a pattern,
// not noise from one data point — see insights.service.ts's own
// thresholds — so an empty list is a genuinely honest "nothing stands
// out yet," never a placeholder.
export const insightSchema = z.object({
  id: z.string(),
  title: z.string(),
  observation: z.string(),
  recommendation: z.string(),
  basis: z.string(),
});
export type InsightDto = z.infer<typeof insightSchema>;

export const insightsSummaryQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(30),
});
export type InsightsSummaryQuery = z.infer<typeof insightsSummaryQuerySchema>;

export const insightsSummarySchema = z.object({
  days: z.number(),
  insights: z.array(insightSchema),
});
export type InsightsSummaryDto = z.infer<typeof insightsSummarySchema>;
