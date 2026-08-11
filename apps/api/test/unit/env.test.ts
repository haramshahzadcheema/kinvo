import { describe, expect, it } from 'vitest';
import { envSchema } from '../../src/config/env';
import { REVOCATION_TTL_SECONDS } from '../../src/core/security/token-revocation';

// Baseline matches vitest.config.ts's own `env` block for the required
// fields — safeParse against a plain object here, never against the real
// `env` singleton (which is built from process.env at module load and
// calls process.exit(1) on failure, not something a test should trigger).
const validBaseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://kinvo:kinvo@localhost:5432/kinvo_test',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGIN: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'test-only-access-token-secret-at-least-32-chars-long',
};

describe('env — JWT_ACCESS_TTL vs. the revocation denylist TTL', () => {
  it('accepts the default 15m TTL', () => {
    const result = envSchema.safeParse(validBaseEnv);
    expect(result.success).toBe(true);
  });

  it(`accepts a TTL exactly equal to the ${REVOCATION_TTL_SECONDS}s denylist TTL`, () => {
    const result = envSchema.safeParse({
      ...validBaseEnv,
      JWT_ACCESS_TTL: `${REVOCATION_TTL_SECONDS}s`,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a TTL longer than the denylist TTL — the exact misconfiguration that would let a revoked membership start working again', () => {
    const result = envSchema.safeParse({ ...validBaseEnv, JWT_ACCESS_TTL: '48h' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'JWT_ACCESS_TTL');
      expect(issue?.message).toMatch(/must not exceed/i);
    }
  });

  it('rejects an equally-too-long TTL expressed as a bare number of seconds', () => {
    const result = envSchema.safeParse({
      ...validBaseEnv,
      JWT_ACCESS_TTL: `${REVOCATION_TTL_SECONDS + 3600}`,
    });
    expect(result.success).toBe(false);
  });
});
