import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Integration tests share one real Postgres database and reset it via
    // TRUNCATE in beforeEach. Running test files in parallel means two
    // files' TRUNCATEs can hit the same tables concurrently — Postgres
    // then deadlocks (each TRUNCATE takes an AccessExclusiveLock).
    // Sequential file execution is the correct trade here: it's what a
    // shared external database demands, not a workaround for a flaky test.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      PORT: '4000',
      DATABASE_URL: 'postgresql://kinvo:kinvo@localhost:5432/kinvo_test',
      REDIS_URL: 'redis://localhost:6379',
      CORS_ORIGIN: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
      JWT_ACCESS_SECRET: 'test-only-access-token-secret-at-least-32-chars-long',
      JWT_ACCESS_TTL: '15m',
      REFRESH_TOKEN_TTL_DAYS: '30',
      REFRESH_TOKEN_COOKIE_NAME: 'kinvo_refresh_token',
    },
  },
});
