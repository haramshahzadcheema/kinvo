import Redis from 'ioredis';
import { env } from '../config/env';
import type { DependencyCheckResult } from './dependency-check';
import { logger } from './logger';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

redis.on('error', (error) => {
  logger.error({ err: error }, 'Redis client error');
});

export async function checkRedisConnection(): Promise<DependencyCheckResult> {
  try {
    if (redis.status === 'wait') {
      await redis.connect();
    }
    const response = await redis.ping();
    return { ok: response === 'PONG' };
  } catch (error) {
    logger.error({ err: error }, 'Redis health check failed');
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown redis error' };
  }
}
