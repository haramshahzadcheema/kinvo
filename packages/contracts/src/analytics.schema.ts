import { z } from 'zod';
import { yellowZonePrioritySchema } from './yellowZone.schema';

// Phase E (Kinvo UI redesign, Intelligence group): every number here is a
// real aggregate over data this codebase already writes for other
// reasons (AssignmentAttempt, VoiceCallPlacement, YellowZoneItem) — none
// of it is estimated or invented. Two stats from the Kinvo.dc.html
// mockup are deliberately NOT reproduced: "Supervisor Hours Saved" (no
// real basis exists for what a manual process would have cost — this
// codebase has never tracked that) and "Avg Replacement Time" (would
// require inferring a "this new assignment replaces that rejected one"
// link this data model doesn't actually carry). "Yellow Zone by
// Category" is also reshaped into "Yellow Zone by Priority" — the mockup's
// categories (Payment Question, Document Missing, ...) require
// classifying transcript CONTENT, which nothing in this codebase does
// yet (that's AI Insights territory); priority is real, structural data
// already computed by escalationClassification.ts.
export const analyticsSummaryQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(90).default(7),
});
export type AnalyticsSummaryQuery = z.infer<typeof analyticsSummaryQuerySchema>;

// `spark` is one value per day across the requested window, oldest
// first — a real daily trend, not a decorative sparkline. `delta` is
// this window's total/rate compared to the immediately preceding
// window of the same length (e.g. this 7 days vs the 7 days before
// that) — omitted (null) when the prior window has no data to compare
// against (division by zero, not a real "0% change").
export const analyticsStatSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  spark: z.array(z.number()),
  deltaPct: z.number().nullable(),
});
export type AnalyticsStatDto = z.infer<typeof analyticsStatSchema>;

export const dailyCallVolumeSchema = z.object({
  date: z.string(),
  automated: z.number().int().nonnegative(),
  escalated: z.number().int().nonnegative(),
});
export type DailyCallVolumeDto = z.infer<typeof dailyCallVolumeSchema>;

export const yellowZonePriorityBreakdownSchema = z.object({
  priority: yellowZonePrioritySchema,
  count: z.number().int().nonnegative(),
});
export type YellowZonePriorityBreakdownDto = z.infer<typeof yellowZonePriorityBreakdownSchema>;

export const analyticsSummarySchema = z.object({
  days: z.number(),
  stats: z.array(analyticsStatSchema),
  dailyCallVolume: z.array(dailyCallVolumeSchema),
  yellowZoneByPriority: z.array(yellowZonePriorityBreakdownSchema),
});
export type AnalyticsSummaryDto = z.infer<typeof analyticsSummarySchema>;
