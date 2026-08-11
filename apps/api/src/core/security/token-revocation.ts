import type Redis from 'ioredis';

const REVOKED_MEMBERSHIP_KEY_PREFIX = 'revoked-membership:';

// A denylist entry only needs to outlive the longest access token that
// could have been issued before the revocation happened — after that, the
// token's own `exp` claim already rejects it, independent of this store.
// Deliberately not derived from the configured JWT_ACCESS_TTL (a free-form
// ms-style string — "15m", "1h", or a bare number of seconds): parsing it
// back into seconds would mean either taking a dependency on the `ms`
// package purely for this or re-implementing the grammar env.ts's Zod
// regex already validates. Realistic JWT_ACCESS_TTL values are minutes,
// so a fixed, generous upper bound is just as correct and far simpler, at
// the cost of a denylist entry occasionally outliving the token it guarded
// against by a few hours of harmless extra Redis memory — not a
// correctness gap, since the check is "is this token's issuedAtMs older
// than the last revocation," not "has this exact key expired yet."
// Exported (not module-private) so config/env.ts can enforce, at startup,
// that JWT_ACCESS_TTL never exceeds it — see that file's own comment for
// the failure mode this closes: a denylist entry that expires before the
// access token it was guarding against does would silently let a revoked
// membership's already-issued tokens start working again.
export const REVOCATION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Closes the one gap `authenticate.ts`'s stateless-JWT design otherwise
 * leaves open: a membership's role changed or removed mid-token-lifetime,
 * where the old access token would otherwise stay valid — with its stale
 * claims — until its own `exp`. Deliberately narrow: this is not a general
 * session store or a replacement for the refresh-token rotation family
 * already handling reuse detection (see auth.service.ts's `refresh`); it
 * only answers "was this membership's access revoked after this token was
 * issued."
 */
export interface TokenRevocationStore {
  /** Marks every access token already issued for this membership, as of
   * now, as no longer trustworthy. */
  revokeMembership(membershipId: string): Promise<void>;
  /** True if this membership was revoked at or after the given token's
   * issued-at time (milliseconds since epoch — see tokens.ts's
   * `issuedAtMs`, a custom claim used instead of the standard `iat` for
   * exactly this comparison). */
  isTokenRevoked(membershipId: string, tokenIssuedAtMs: number): Promise<boolean>;
}

export function createTokenRevocationStore(redis: Redis): TokenRevocationStore {
  return {
    async revokeMembership(membershipId: string): Promise<void> {
      await redis.set(
        `${REVOKED_MEMBERSHIP_KEY_PREFIX}${membershipId}`,
        Date.now().toString(),
        'EX',
        REVOCATION_TTL_SECONDS,
      );
    },

    async isTokenRevoked(membershipId: string, tokenIssuedAtMs: number): Promise<boolean> {
      const revokedAtMs = await redis.get(`${REVOKED_MEMBERSHIP_KEY_PREFIX}${membershipId}`);
      if (revokedAtMs === null) {
        return false;
      }
      return tokenIssuedAtMs < Number(revokedAtMs);
    },
  };
}
