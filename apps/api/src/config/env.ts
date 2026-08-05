import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  CORS_ORIGIN: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
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
