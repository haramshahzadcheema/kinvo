import Redis from 'ioredis';
import { env } from '../../config/env';
import { logger } from '../logger';

/**
 * BullMQ's own dedicated Redis connection — deliberately separate from
 * core/redis.ts's singleton. BullMQ's blocking commands require
 * `maxRetriesPerRequest: null`, which is the opposite of what the
 * auth-critical token-revocation path needs (core/redis.ts uses
 * `maxRetriesPerRequest: 1` there so a revocation check fails fast instead
 * of hanging behind BullMQ's blocking semantics). Sharing one connection
 * between the two would force a single, wrong-for-someone value onto both.
 * This was already flagged in docs/ARCHITECTURE.md §14 before Phase 4
 * existed; this is that flag acted on.
 */
export const queueConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

queueConnection.on('error', (error) => {
  logger.error({ err: error }, 'BullMQ Redis connection error');
});
