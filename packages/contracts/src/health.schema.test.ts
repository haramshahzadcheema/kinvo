import { describe, expect, it } from 'vitest';
import { livenessResponseSchema, readinessResponseSchema } from './health.schema';

describe('livenessResponseSchema', () => {
  it('accepts a well-formed liveness payload', () => {
    const result = livenessResponseSchema.safeParse({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a status other than "ok"', () => {
    const result = livenessResponseSchema.safeParse({
      status: 'degraded',
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

describe('readinessResponseSchema', () => {
  it('accepts a payload with healthy dependencies', () => {
    const result = readinessResponseSchema.safeParse({
      status: 'ok',
      dependencies: [
        { name: 'postgres', status: 'ok', latencyMs: 4 },
        { name: 'redis', status: 'ok', latencyMs: 1 },
      ],
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts a payload reporting a failed dependency', () => {
    const result = readinessResponseSchema.safeParse({
      status: 'error',
      dependencies: [{ name: 'postgres', status: 'error', error: 'connection refused' }],
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing timestamp', () => {
    const result = readinessResponseSchema.safeParse({
      status: 'ok',
      dependencies: [],
    });
    expect(result.success).toBe(false);
  });
});
