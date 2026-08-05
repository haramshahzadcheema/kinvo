import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import {
  InvalidAccessTokenError,
  generateInvitationTokenValue,
  generateRefreshTokenValue,
  hashInvitationTokenValue,
  hashRefreshTokenValue,
  refreshTokenExpiryDate,
  signAccessToken,
  verifyAccessToken,
} from '../../src/core/security/tokens';

const payload = {
  sub: 'user-1',
  organizationId: 'org-1',
  membershipId: 'membership-1',
  role: 'OWNER' as const,
};

describe('access tokens', () => {
  it('round-trips a signed token back to its original payload', () => {
    const token = signAccessToken(payload);
    expect(verifyAccessToken(token)).toEqual(payload);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyAccessToken('not-a-real-token')).toThrowError(InvalidAccessTokenError);
  });

  it('rejects a token signed with the wrong shape of payload', () => {
    // Simulate a token that's structurally a JWT but doesn't carry the
    // claims our schema requires — must fail closed, not pass through
    // partial/garbage claims.
    const badToken = jwt.sign({ nonsense: true }, env.JWT_ACCESS_SECRET);
    expect(() => verifyAccessToken(badToken)).toThrowError(InvalidAccessTokenError);
  });
});

describe('refresh tokens', () => {
  it('generates a non-empty, sufficiently random raw value', () => {
    const a = generateRefreshTokenValue();
    const b = generateRefreshTokenValue();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it('hashes deterministically — same input, same hash', () => {
    const raw = generateRefreshTokenValue();
    expect(hashRefreshTokenValue(raw)).toBe(hashRefreshTokenValue(raw));
  });

  it('hashes different raw values to different hashes', () => {
    expect(hashRefreshTokenValue(generateRefreshTokenValue())).not.toBe(
      hashRefreshTokenValue(generateRefreshTokenValue()),
    );
  });

  it('computes an expiry date in the future', () => {
    expect(refreshTokenExpiryDate().getTime()).toBeGreaterThan(Date.now());
  });
});

describe('invitation tokens', () => {
  it('generates a non-empty raw value and hashes it deterministically', () => {
    const raw = generateInvitationTokenValue();
    expect(raw.length).toBeGreaterThanOrEqual(32);
    expect(hashInvitationTokenValue(raw)).toBe(hashInvitationTokenValue(raw));
  });

  it('generates different raw values on each call', () => {
    expect(generateInvitationTokenValue()).not.toBe(generateInvitationTokenValue());
  });
});
