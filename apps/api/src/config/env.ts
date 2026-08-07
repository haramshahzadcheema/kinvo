import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    CORS_ORIGIN: z.string().min(1),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    // Must actually match the `ms`-style duration grammar jsonwebtoken's
    // `expiresIn` expects (e.g. "15m", "1h") or a bare number of seconds —
    // signAccessToken (core/security/tokens.ts) casts this value to
    // jwt.SignOptions['expiresIn'] on the strength of this validation, so a
    // loose z.string() here would make that cast an unchecked assumption
    // instead of an enforced invariant.
    JWT_ACCESS_TTL: z
      .string()
      .regex(
        /^\d+(\.\d+)?\s?(ms|s|m|h|d|w|y)$|^\d+$/i,
        'JWT_ACCESS_TTL must be an ms-style duration (e.g. "15m") or a plain number of seconds',
      )
      .default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    REFRESH_TOKEN_COOKIE_NAME: z.string().default('kinvo_refresh_token'),
    // Optional at the schema level (see the .refine below) — the test
    // environment wires core/container.ts to a FakeVoiceProvider instead of
    // a real CallEAdapter, so it has no legitimate use for a real key and
    // shouldn't be forced to fabricate one.
    CALLE_API_KEY: z.string().min(1).optional(),
    CALLE_BASE_URL: z.string().url().optional(),
    VOICE_CALLS_CONCURRENCY: z.coerce.number().int().positive().default(5),
    VOICE_WEBHOOK_CONCURRENCY: z.coerce.number().int().positive().default(10),
    // How long a non-terminal attempt is allowed to sit before
    // reconcileStaleAttempts (voice.service.ts) treats it as stuck and
    // forces a terminal system_error — Kinvo's own timeout policy, not
    // CALL-E's; see VoiceCallOutcome's `pending` case.
    VOICE_RECONCILE_STALE_AFTER_MINUTES: z.coerce.number().int().positive().default(30),
    VOICE_RECONCILE_INTERVAL_MINUTES: z.coerce.number().int().positive().default(5),
  })
  .refine((data) => data.NODE_ENV === 'test' || Boolean(data.CALLE_API_KEY), {
    message: 'CALLE_API_KEY is required outside the test environment.',
    path: ['CALLE_API_KEY'],
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // The app must not start with a missing or malformed configuration —
    // failing loudly here beats failing confusingly at first use.
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

/**
 * Narrows `env.CALLE_API_KEY` from `string | undefined` to `string` for the
 * (non-test) call sites that construct a real CallEAdapter. Safe by
 * construction: `loadEnv` above already exits the process if this is unset
 * outside the test environment, via the schema's `.refine`.
 */
export function requireCalleApiKey(): string {
  if (!env.CALLE_API_KEY) {
    throw new Error('CALLE_API_KEY is required outside the test environment.');
  }
  return env.CALLE_API_KEY;
}
