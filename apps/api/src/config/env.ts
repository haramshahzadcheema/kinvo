import { z } from 'zod';
import { REVOCATION_TTL_SECONDS } from '../core/security/token-revocation';

// Mirrors exactly the shapes JWT_ACCESS_TTL's own regex below already
// accepts ("15m", "1h", "2.5d", or a bare number of seconds) — kept as a
// small local parser rather than a dependency on the `ms` package (which
// jsonwebtoken itself uses internally, but only as a transitive dependency
// apps/api never declares directly) purely to compare the configured value
// against REVOCATION_TTL_SECONDS below.
const DURATION_UNIT_SECONDS: Record<string, number> = {
  ms: 0.001,
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 60 * 60 * 24,
  w: 60 * 60 * 24 * 7,
  y: 60 * 60 * 24 * 365.25,
};

function parseDurationToSeconds(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s?(ms|s|m|h|d|w|y)$/i.exec(value);
  if (!match || !match[1] || !match[2]) {
    return Number(value); // The bare-seconds shape — the only other form the regex below allows.
  }
  const unitSeconds = DURATION_UNIT_SECONDS[match[2].toLowerCase()] ?? 0;
  return Number(match[1]) * unitSeconds;
}

// Exported alongside `env` (not just used internally by loadEnv) so a unit
// test can exercise `.safeParse` directly against a synthetic payload —
// `env` itself is a module-load-time singleton built from the real
// `process.env` that calls `process.exit(1)` on failure, which isn't
// something a test should trigger just to prove a validation rule works.
export const envSchema = z
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
  })
  // The membership-revocation denylist (core/security/token-revocation.ts)
  // stores each revocation for a fixed REVOCATION_TTL_SECONDS, on the
  // assumption that no access token issued before it could still be alive
  // once that entry expires. That assumption is only true if access tokens
  // themselves never outlive the denylist entry — nothing about the JWT
  // format or jsonwebtoken's `expiresIn` option enforces that on its own,
  // so a JWT_ACCESS_TTL configured longer than REVOCATION_TTL_SECONDS would
  // silently let a revoked membership's already-issued tokens start working
  // again the moment the (now-expired) denylist entry falls out of Redis,
  // even though the token itself is still technically unexpired. Caught
  // here, at startup, rather than left as a runbook footnote an operator
  // could misconfigure past.
  .refine((data) => parseDurationToSeconds(data.JWT_ACCESS_TTL) <= REVOCATION_TTL_SECONDS, {
    message: `JWT_ACCESS_TTL must not exceed ${REVOCATION_TTL_SECONDS} seconds (the membership-revocation denylist's TTL) — a longer access-token lifetime would let a revoked membership's already-issued tokens start working again once the denylist entry expires first.`,
    path: ['JWT_ACCESS_TTL'],
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
