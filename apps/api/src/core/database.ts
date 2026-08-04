import { Pool } from 'pg';
import { env } from '../config/env';
import type { DependencyCheckResult } from './dependency-check';
import { logger } from './logger';

// Phase 0 has no Prisma models yet (`prisma generate` refuses to run with
// zero models — that's a hard CLI constraint, not a config gap). This raw
// `pg` pool exists solely to prove real Postgres connectivity for the
// readiness check. Phase 1 introduces the first models and the generated
// Prisma client alongside them; this pool is not meant to grow into a data
// access layer.
export const pool = new Pool({ connectionString: env.DATABASE_URL });

pool.on('error', (error) => {
  logger.error({ err: error }, 'Unexpected Postgres pool error');
});

export async function checkDatabaseConnection(): Promise<DependencyCheckResult> {
  try {
    await pool.query('SELECT 1');
    return { ok: true };
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed');
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
}
