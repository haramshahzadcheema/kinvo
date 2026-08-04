import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import type { Container } from '../src/core/container';
import type { DependencyChecker } from '../src/core/dependency-check';
import { createHealthService } from '../src/modules/health/health.service';

// Real dependency injection, not module mocking: health.service.ts accepts
// its checkers as constructor arguments, so tests inject fakes directly
// through the same composition root the app itself uses — no `vi.mock()`
// hijacking the module system required. This is the pattern the rest of
// the codebase (auth, CALL-E's VoiceProvider, etc.) should copy.
function createTestContainer(overrides?: {
  checkDatabaseConnection?: DependencyChecker;
  checkRedisConnection?: DependencyChecker;
  cacheTtlMs?: number;
}): {
  container: Container;
  checkDatabaseConnection: DependencyChecker;
  checkRedisConnection: DependencyChecker;
} {
  const checkDatabaseConnection =
    overrides?.checkDatabaseConnection ?? vi.fn().mockResolvedValue({ ok: true });
  const checkRedisConnection =
    overrides?.checkRedisConnection ?? vi.fn().mockResolvedValue({ ok: true });
  const healthService = createHealthService({
    checkDatabaseConnection,
    checkRedisConnection,
    cacheTtlMs: overrides?.cacheTtlMs ?? 0,
  });

  return { container: { healthService }, checkDatabaseConnection, checkRedisConnection };
}

describe('GET /health/live', () => {
  it('returns 200 with status ok without checking dependencies', async () => {
    const { container, checkDatabaseConnection, checkRedisConnection } = createTestContainer();
    const app = createApp(container);
    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(checkDatabaseConnection).not.toHaveBeenCalled();
    expect(checkRedisConnection).not.toHaveBeenCalled();
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when all dependencies are healthy', async () => {
    const { container } = createTestContainer();
    const app = createApp(container);
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.dependencies).toHaveLength(2);
  });

  it('returns 503 with dependency detail when the database is unreachable', async () => {
    const { container } = createTestContainer({
      checkDatabaseConnection: vi
        .fn()
        .mockResolvedValue({ ok: false, error: 'connection refused' }),
    });
    const app = createApp(container);
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('error');
    expect(response.body.dependencies).toContainEqual(
      expect.objectContaining({ name: 'postgres', status: 'error', error: 'connection refused' }),
    );
  });

  it('caches the readiness result for the configured TTL instead of re-checking every call', async () => {
    const { container, checkDatabaseConnection, checkRedisConnection } = createTestContainer({
      cacheTtlMs: 60_000,
    });
    const app = createApp(container);

    await request(app).get('/health/ready');
    await request(app).get('/health/ready');

    expect(checkDatabaseConnection).toHaveBeenCalledTimes(1);
    expect(checkRedisConnection).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent cache-miss requests into a single underlying check', async () => {
    const { container, checkDatabaseConnection } = createTestContainer({ cacheTtlMs: 60_000 });
    const app = createApp(container);

    await Promise.all([
      request(app).get('/health/ready'),
      request(app).get('/health/ready'),
      request(app).get('/health/ready'),
    ]);

    expect(checkDatabaseConnection).toHaveBeenCalledTimes(1);
  });
});

describe('unmatched routes', () => {
  it('returns a structured 404 error envelope', async () => {
    const { container } = createTestContainer();
    const app = createApp(container);
    const response = await request(app).get('/definitely-not-a-route');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });
});
