import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';

const accessTokenClaimsSchema = z.object({
  sub: z.string(),
  organizationId: z.string(),
  membershipId: z.string(),
  role: z.enum(['OWNER', 'ADMIN', 'DISPATCHER', 'VIEWER']),
});

/** The claims a caller supplies when signing a new token — deliberately
 * excludes `issuedAtMs`/`exp`, which are stamped on automatically below. */
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

// Extends the sign-time claims with `issuedAtMs` — a custom, explicit
// millisecond-precision timestamp, not the standard `iat` claim
// jsonwebtoken also auto-populates. `iat` is a JWT-spec NumericDate:
// whole seconds only. The revocation check in authenticate.ts needs to
// compare a token's issue time against Redis's "revoked since" timestamp
// precisely enough to tell apart "the token refresh() minted immediately
// after a revocation" from "the stale token that revocation was meant to
// invalidate" — two events that can legitimately land in the same
// wall-clock second (revoke a role, client refreshes right after).
// Comparing at whole-second resolution collapses that distinction; this
// was caught by a real failing integration test, not assumed up front.
const verifiedAccessTokenPayloadSchema = accessTokenClaimsSchema.extend({
  issuedAtMs: z.number(),
});

export type AccessTokenPayload = z.infer<typeof verifiedAccessTokenPayloadSchema>;

export function signAccessToken(payload: AccessTokenClaims): string {
  // jsonwebtoken's SignOptions.expiresIn is a branded string type (from the
  // `ms` package) narrower than `string` — our own Zod validation on
  // JWT_ACCESS_TTL is what actually guarantees the format (e.g. "15m"), so
  // this cast reflects a real, enforced invariant, not an unchecked escape.
  return jwt.sign({ ...payload, issuedAtMs: Date.now() }, env.JWT_ACCESS_SECRET, {
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

  const parsed = verifiedAccessTokenPayloadSchema.safeParse(decoded);
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
