import type { DependencyHealth, ReadinessResponse } from '@kinvo/contracts';
import { checkDatabaseConnection } from '../../core/database';
import { checkRedisConnection } from '../../core/redis';
import type { DependencyCheckResult } from '../../core/dependency-check';

async function timed(
  fn: () => Promise<DependencyCheckResult>,
): Promise<{ result: DependencyCheckResult; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - start };
}

export async function getReadiness(): Promise<ReadinessResponse> {
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
