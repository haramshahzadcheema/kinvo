import type { DependencyHealth, ReadinessResponse } from '@kinvo/contracts';
import type { DependencyChecker, DependencyCheckResult } from '../../core/dependency-check';

export interface HealthServiceDependencies {
  checkDatabaseConnection: DependencyChecker;
  checkRedisConnection: DependencyChecker;
  /**
   * How long a computed readiness result may be reused before recomputing.
   * Without this, every caller of /health/ready (monitors, the dashboard's
   * polling, or plain abuse) triggers a real Postgres query and Redis ping.
   * Defaults to 2s — short enough that a genuine outage is reflected almost
   * immediately, long enough to absorb repeated/concurrent calls.
   */
  cacheTtlMs?: number;
}

export interface HealthService {
  getReadiness: () => Promise<ReadinessResponse>;
}

async function timed(
  fn: DependencyChecker,
): Promise<{ result: DependencyCheckResult; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - start };
}

export function createHealthService({
  checkDatabaseConnection,
  checkRedisConnection,
  cacheTtlMs = 2000,
}: HealthServiceDependencies): HealthService {
  let cached: { result: ReadinessResponse; expiresAt: number } | undefined;
  let pending: Promise<ReadinessResponse> | undefined;

  async function computeReadiness(): Promise<ReadinessResponse> {
    const [databaseCheck, redisCheck] = await Promise.all([
      timed(checkDatabaseConnection),
      timed(checkRedisConnection),
    ]);

    const dependencies: DependencyHealth[] = [
      {
        name: 'postgres',
        status: databaseCheck.result.ok ? 'ok' : 'error',
        latencyMs: databaseCheck.latencyMs,
        error: databaseCheck.result.error,
      },
      {
        name: 'redis',
        status: redisCheck.result.ok ? 'ok' : 'error',
        latencyMs: redisCheck.latencyMs,
        error: redisCheck.result.error,
      },
    ];

    const status = dependencies.every((dependency) => dependency.status === 'ok') ? 'ok' : 'error';

    return {
      status,
      dependencies,
      timestamp: new Date().toISOString(),
    };
  }

  async function getReadiness(): Promise<ReadinessResponse> {
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }

    // Dedup concurrent cache-miss callers into a single underlying check —
    // otherwise a burst of simultaneous requests on a cold cache would each
    // fire their own DB query/Redis ping, defeating the point of caching.
    pending ??= computeReadiness()
      .then((result) => {
        cached = { result, expiresAt: Date.now() + cacheTtlMs };
        return result;
      })
      .finally(() => {
        pending = undefined;
      });

    return pending;
  }

  return { getReadiness };
}
