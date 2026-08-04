import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'error']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const dependencyHealthSchema = z.object({
  name: z.string(),
  status: healthStatusSchema,
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
});
export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
});
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

export const readinessResponseSchema = z.object({
  status: healthStatusSchema,
  dependencies: z.array(dependencyHealthSchema),
  timestamp: z.string().datetime(),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
