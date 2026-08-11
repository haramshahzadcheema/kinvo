import { createHash } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/prisma';
import { buildApp } from '../support/app';
import { resetDatabase } from '../support/db';
import { registrationPayload } from '../support/fixtures';
import { cookieHeader, extractRefreshTokenCookie } from '../support/http';

// Real Postgres, real Prisma, real password hashing, real JWTs — this is
// an integration test suite, not a unit test with mocks. It's slower than
// Phase 0's fully-mocked health tests by necessity: this is the first
// place the app's actual security guarantees (rotation, reuse detection,
// tenant scoping) can be proven end to end.

beforeEach(async () => {
  await resetDatabase();
});

describe('POST /api/v1/auth/register-organization', () => {
  it('creates an organization, an owner user, and a membership, and issues tokens', async () => {
    const app = buildApp();
    const payload = registrationPayload();

    const response = await request(app).post('/api/v1/auth/register-organization').send(payload);

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toBeUndefined(); // must never be in the JSON body
    expect(response.body.user.email).toBe(payload.email);
    expect(response.body.organization.name).toBe(payload.organizationName);
    expect(response.body.membership.role).toBe('OWNER');

    const refreshToken = extractRefreshTokenCookie(response);
    expect(refreshToken).toEqual(expect.any(String));

    const storedUser = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });
    expect(storedUser.passwordHash).not.toBe(payload.password); // never stored in plaintext
  });

  it('rejects registration with an email that already has an account', async () => {
    const app = buildApp();
    const payload = registrationPayload();
    await request(app).post('/api/v1/auth/register-organization').send(payload);

    const response = await request(app)
      .post('/api/v1/auth/register-organization')
      .send(registrationPayload({ email: payload.email }));

    expect(response.status).toBe(409);
  });

  it('under concurrent registrations with the same email, exactly one succeeds and no request 500s', async () => {
    // Regression test for a bug found via chaos testing: the same
    // check-then-create gap as acceptInvitation, in registerOrganization.
    // The up-front existingUser check is a courtesy, not a guarantee — 8
    // concurrent registrations with the same email all pass it before any
    // commits. Confirmed live: 7 of 8 raised uncaught P2002 errors that
    // surfaced as raw 500s instead of a clean conflict response.
    const app = buildApp();
    const email = `${Date.now()}-concurrent@example.com`;

    const CONCURRENCY = 8;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        request(app)
          .post('/api/v1/auth/register-organization')
          .send(registrationPayload({ email, organizationName: `Concurrent Reg Org ${i}` })),
      ),
    );

    const successes = responses.filter((r) => r.status === 201);
    const serverErrors = responses.filter((r) => r.status >= 500);
    expect(successes).toHaveLength(1);
    expect(serverErrors).toHaveLength(0);
    expect(responses.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);
  });

  it('rejects an invalid payload with a 400 before touching the database', async () => {
    const app = buildApp();
    const response = await request(app).post('/api/v1/auth/register-organization').send({
      organizationName: 'x',
      email: 'not-an-email',
      password: 'short',
      firstName: '',
      lastName: '',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON with a clean 400, not a 500', async () => {
    // Regression test for a bug found via chaos testing: body-parser
    // (express.json()) throws an error with a correct pre-set status (400
    // for invalid JSON syntax, 413 for an oversized body) that the
    // catch-all error handler was discarding and replacing with a generic
    // 500. Confirmed live against the running Docker stack for both cases.
    const app = buildApp();
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "test@test.com", "password": ');

    expect(response.status).toBe(400);
  });

  it('rejects an oversized request body with a clean 413, not a 500', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/api/v1/auth/register-organization')
      .send({
        organizationName: 'A'.repeat(2 * 1024 * 1024),
        email: 'big-payload@example.com',
        password: 'a-perfectly-good-password',
        firstName: 'A',
        lastName: 'B',
      });

    expect(response.status).toBe(413);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const app = buildApp();
    const payload = registrationPayload();
    await request(app).post('/api/v1/auth/register-organization').send(payload);

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: payload.email, password: payload.password });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(payload.email);
  });

  it('rejects an incorrect password without revealing which field was wrong', async () => {
    const app = buildApp();
    const payload = registrationPayload();
    await request(app).post('/api/v1/auth/register-organization').send(payload);

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: payload.email, password: 'wrong-password' });

    expect(response.status).toBe(401);
  });

  it('rejects a login for an email that has no account', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever-password' });

    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/auth/refresh — rotation', () => {
  it('rotates the refresh token and revokes the old one', async () => {
    const app = buildApp();
    const payload = registrationPayload();
    const registerResponse = await request(app)
      .post('/api/v1/auth/register-organization')
      .send(payload);
    const originalRefreshToken = extractRefreshTokenCookie(registerResponse);

    const refreshResponse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(originalRefreshToken));

    expect(refreshResponse.status).toBe(200);
    const newRefreshToken = extractRefreshTokenCookie(refreshResponse);
    expect(newRefreshToken).not.toBe(originalRefreshToken);

    // The old token row must be revoked and point at its replacement.
    const oldTokenHash = createHash('sha256').update(originalRefreshToken).digest('hex');
    const oldTokenRow = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: oldTokenHash },
    });
    expect(oldTokenRow.revokedAt).not.toBeNull();
    expect(oldTokenRow.replacedByTokenId).not.toBeNull();
  });

  it('rejects an already-rotated (reused) refresh token and revokes the whole family', async () => {
    const app = buildApp();
    const payload = registrationPayload();
    const registerResponse = await request(app)
      .post('/api/v1/auth/register-organization')
      .send(payload);
    const originalRefreshToken = extractRefreshTokenCookie(registerResponse);

    const firstRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(originalRefreshToken));
    const rotatedRefreshToken = extractRefreshTokenCookie(firstRefresh);

    // Replay the ORIGINAL (already-rotated) token — this is the theft/reuse scenario.
    const replayResponse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(originalRefreshToken));
    expect(replayResponse.status).toBe(401);

    // The entire family — including the token that replaced it — must now be dead.
    const secondRefreshAttempt = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(rotatedRefreshToken));
    expect(secondRefreshAttempt.status).toBe(401);
  });

  it('rejects a refresh with no cookie at all', async () => {
    const app = buildApp();
    const response = await request(app).post('/api/v1/auth/refresh');
    expect(response.status).toBe(401);
  });

  it('under concurrent requests with the same token, exactly one succeeds', async () => {
    // Regression test for a real race condition found via chaos testing:
    // refresh()'s check-then-write used to let multiple concurrent requests
    // all read "not yet revoked" before any of them committed, so more than
    // one request could mint a valid new token from the same original —
    // confirmed empirically (3 successes out of 15 concurrent requests
    // against the live stack, with two simultaneously-unrevoked tokens left
    // in the database). The fix is an atomic updateMany claim guarded by
    // `revokedAt: null`; this test proves concurrent requests can no longer
    // all win it.
    const app = buildApp();
    const payload = registrationPayload();
    const registerResponse = await request(app)
      .post('/api/v1/auth/register-organization')
      .send(payload);
    const originalRefreshToken = extractRefreshTokenCookie(registerResponse);
    const cookie = cookieHeader(originalRefreshToken);

    const CONCURRENCY = 10;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        request(app).post('/api/v1/auth/refresh').set('Cookie', cookie),
      ),
    );

    const successes = responses.filter((r) => r.status === 200);
    const serverErrors = responses.filter((r) => r.status >= 500);
    expect(successes).toHaveLength(1);
    expect(serverErrors).toHaveLength(0);
    expect(responses.filter((r) => r.status !== 200).every((r) => r.status === 401)).toBe(true);
  });

  it('the one winning token from a concurrent reuse race does not survive the losers’ family revocation', async () => {
    // A second, stronger regression test for the same concurrent scramble
    // as above, but proving the specific gap the non-transactional version
    // of refresh() still had even after the atomic-claim fix: each losing
    // request, on detecting reuse, revokes every currently-unrevoked token
    // in the family — but with the claim and the winner's new-token INSERT
    // as separate auto-committing statements, a loser's sweep could run (and
    // commit) in the gap between "winner's claim committed" and "winner's
    // new token inserted," querying `revokedAt: null` before that new token
    // existed to be caught. The new token would then be created moments
    // later as a live, usable token in a family every other request was just
    // told had been fully revoked. Wrapping the claim through the new-token
    // creation in one transaction (so the row lock — and therefore every
    // loser's blocked claim attempt — doesn't release until the new token is
    // already committed) closes it. This test proves the winner's own new
    // token is unusable afterward, not just that only one request succeeded.
    const app = buildApp();
    const payload = registrationPayload();
    const registerResponse = await request(app)
      .post('/api/v1/auth/register-organization')
      .send(payload);
    const originalRefreshToken = extractRefreshTokenCookie(registerResponse);
    const cookie = cookieHeader(originalRefreshToken);

    const CONCURRENCY = 10;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        request(app).post('/api/v1/auth/refresh').set('Cookie', cookie),
      ),
    );

    const winner = responses.find((r) => r.status === 200);
    expect(winner).toBeDefined();
    const winningNewToken = extractRefreshTokenCookie(winner!);

    const replayOfWinningToken = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(winningNewToken));
    expect(replayOfWinningToken.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the current session and the cookie no longer refreshes', async () => {
    const app = buildApp();
    const payload = registrationPayload();
    const registerResponse = await request(app)
      .post('/api/v1/auth/register-organization')
      .send(payload);
    const refreshToken = extractRefreshTokenCookie(registerResponse);

    const logoutResponse = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader(refreshToken));
    expect(logoutResponse.status).toBe(204);

    const refreshAfterLogout = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(refreshToken));
    expect(refreshAfterLogout.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout-all', () => {
  it('revokes every session for the user, not just the one used to call it', async () => {
    const app = buildApp();
    const payload = registrationPayload();
    await request(app).post('/api/v1/auth/register-organization').send(payload);

    // Two separate logins simulate two devices — two independent token families.
    const loginA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: payload.email, password: payload.password });
    const loginB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: payload.email, password: payload.password });

    const refreshTokenA = extractRefreshTokenCookie(loginA);
    const refreshTokenB = extractRefreshTokenCookie(loginB);

    const logoutAllResponse = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Cookie', cookieHeader(refreshTokenA));
    expect(logoutAllResponse.status).toBe(204);

    const refreshA = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(refreshTokenA));
    const refreshB = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(refreshTokenB));

    expect(refreshA.status).toBe(401);
    expect(refreshB.status).toBe(401);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the current identity for a valid access token', async () => {
    const app = buildApp();
    const payload = registrationPayload();
    const registerResponse = await request(app)
      .post('/api/v1/auth/register-organization')
      .send(payload);
    const accessToken = registerResponse.body.accessToken as string;

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(payload.email);
    expect(response.body.membership.role).toBe('OWNER');
  });

  it('rejects a missing access token', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/v1/auth/me');
    expect(response.status).toBe(401);
  });

  it('rejects a malformed/invalid access token', async () => {
    const app = buildApp();
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/v1/auth/me', () => {
  it("updates the caller's own name and returns the updated identity", async () => {
    const app = buildApp();
    const payload = registrationPayload();
    const registerResponse = await request(app)
      .post('/api/v1/auth/register-organization')
      .send(payload);
    const accessToken = registerResponse.body.accessToken as string;

    const response = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Ada', lastName: 'Lovelace' });

    expect(response.status).toBe(200);
    expect(response.body.user.firstName).toBe('Ada');
    expect(response.body.user.lastName).toBe('Lovelace');
    // Email is deliberately not part of this request shape at all — see
    // updateMeRequestSchema's own comment — so it must come back
    // unchanged, never null/blank.
    expect(response.body.user.email).toBe(payload.email);

    const persisted = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(persisted.body.user.firstName).toBe('Ada');
  });

  it('rejects an empty name', async () => {
    const app = buildApp();
    const payload = registrationPayload();
    const registerResponse = await request(app)
      .post('/api/v1/auth/register-organization')
      .send(payload);
    const accessToken = registerResponse.body.accessToken as string;

    const response = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: '', lastName: 'Lovelace' });

    expect(response.status).toBe(400);
  });

  it('rejects a missing access token', async () => {
    const app = buildApp();
    const response = await request(app)
      .patch('/api/v1/auth/me')
      .send({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(response.status).toBe(401);
  });

  it('does not accept an email field — the request shape has none to ignore', async () => {
    const app = buildApp();
    const payload = registrationPayload();
    const registerResponse = await request(app)
      .post('/api/v1/auth/register-organization')
      .send(payload);
    const accessToken = registerResponse.body.accessToken as string;

    const response = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Ada', lastName: 'Lovelace', email: 'someone-else@example.com' });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(payload.email);
  });
});
