import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';

const accessTokenPayloadSchema = z.object({
  sub: z.string(),
  organizationId: z.string(),
  membershipId: z.string(),
  role: z.enum(['OWNER', 'ADMIN', 'DISPATCHER', 'VIEWER']),
});

export type AccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;

export function signAccessToken(payload: AccessTokenPayload): string {
  // jsonwebtoken's SignOptions.expiresIn is a branded string type (from the
  // `ms` package) narrower than `string` — our own Zod validation on
  // JWT_ACCESS_TTL is what actually guarantees the format (e.g. "15m"), so
  // this cast reflects a real, enforced invariant, not an unchecked escape.
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
  });
}

export class InvalidAccessTokenError extends Error {
  constructor(cause?: unknown) {
    super('Invalid or expired access token.');
    this.name = 'InvalidAccessTokenError';
    this.cause = cause;
  }
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch (error) {
    throw new InvalidAccessTokenError(error);
  }

  const parsed = accessTokenPayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new InvalidAccessTokenError(parsed.error);
  }

  return parsed.data;
}

/** The raw, random refresh token value handed to the client. Never stored. */
export function generateRefreshTokenValue(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 of the raw refresh token value — this, not the raw value, is what's stored. */
export function hashRefreshTokenValue(rawValue: string): string {
  return createHash('sha256').update(rawValue).digest('hex');
}

export function refreshTokenExpiryDate(): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + env.REFRESH_TOKEN_TTL_DAYS);
  return expiry;
}

/** The raw, random invitation token embedded in the invite link. Never stored. */
export function generateInvitationTokenValue(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 of the raw invitation token value — this, not the raw value, is what's stored. */
export function hashInvitationTokenValue(rawValue: string): string {
  return createHash('sha256').update(rawValue).digest('hex');
}
