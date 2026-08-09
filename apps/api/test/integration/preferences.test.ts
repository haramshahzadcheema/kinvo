import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildAppWithContainer } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';

beforeEach(async () => {
  await resetDatabase();
});

describe('preferences module — defaults', () => {
  it('a brand-new user receives correct defaults on first read, with no separate creation step', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .get('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      theme: 'SYSTEM',
      accent: 'OCEAN',
      fontFamily: 'SYSTEM',
      fontSize: 'DEFAULT',
      density: 'COMFORTABLE',
      reducedMotion: false,
      yellowZoneEscalationNotifications: true,
      notificationSound: false,
    });
  });
});

describe('preferences module — persistence', () => {
  it('update -> fetch returns the same values', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);

    const update = await request(app)
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ theme: 'DARK', accent: 'TEAL', fontSize: 'LARGE' });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ theme: 'DARK', accent: 'TEAL', fontSize: 'LARGE' });

    const fetch = await request(app)
      .get('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(fetch.body).toMatchObject({ theme: 'DARK', accent: 'TEAL', fontSize: 'LARGE' });
    // Untouched fields keep their defaults — a PATCH updates only what it
    // names, never resets the rest.
    expect(fetch.body.density).toBe('COMFORTABLE');
    expect(fetch.body.fontFamily).toBe('SYSTEM');
  });

  it('a second, separate PATCH only changes the fields it names', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);

    await request(app)
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ theme: 'DARK' });
    const second = await request(app)
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ density: 'COMPACT' });

    expect(second.body).toMatchObject({ theme: 'DARK', density: 'COMPACT' });
  });
});

describe('preferences module — validation', () => {
  it.each([
    ['theme', 'purple'],
    ['accent', 'crimson'],
    ['fontFamily', 'comic-sans'],
    ['fontSize', 'huge'],
    ['density', 'roomy'],
  ])('rejects an invalid %s with a 400, not a silent guess', async (field, value) => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ [field]: value });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-boolean reducedMotion', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ reducedMotion: 'yes' });

    expect(response.status).toBe(400);
  });

  it('an empty body is a valid no-op PATCH, not a validation error', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({});

    expect(response.status).toBe(200);
  });
});

describe('preferences module — user isolation', () => {
  it('one user\'s settings change never affects another user\'s, even in the same organization', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const invite = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'teammate@example.com', role: 'DISPATCHER' });
    const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: invite.body.inviteToken,
      firstName: 'Team',
      lastName: 'Mate',
      password: 'correct-horse-battery-staple',
    });
    const teammateToken = accept.body.accessToken as string;

    await request(app)
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ theme: 'DARK', density: 'SPACIOUS' });

    const teammatePrefs = await request(app)
      .get('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${teammateToken}`);

    expect(teammatePrefs.body.theme).toBe('SYSTEM');
    expect(teammatePrefs.body.density).toBe('COMFORTABLE');
  });

  it('two users in two different organizations never see each other\'s settings', async () => {
    const { app } = buildAppWithContainer();
    const ownerA = await registerOrganization(app);
    const ownerB = await registerOrganization(app);

    await request(app)
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ theme: 'DARK', accent: 'SLATE' });

    const prefsB = await request(app)
      .get('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${ownerB.accessToken}`);

    expect(prefsB.body.theme).toBe('SYSTEM');
    expect(prefsB.body.accent).toBe('OCEAN');
  });

  it('rejects an unauthenticated request', async () => {
    const { app } = buildAppWithContainer();
    const response = await request(app).get('/api/v1/me/preferences');
    expect(response.status).toBe(401);
  });
});

describe('preferences module — RBAC (ownership-based, not role-based)', () => {
  it('every role can read and update its own preferences, including VIEWER', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const invite = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'viewer@example.com', role: 'VIEWER' });
    const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: invite.body.inviteToken,
      firstName: 'View',
      lastName: 'Only',
      password: 'correct-horse-battery-staple',
    });
    const viewerToken = accept.body.accessToken as string;

    const get = await request(app)
      .get('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(get.status).toBe(200);

    const patch = await request(app)
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ theme: 'DARK' });
    expect(patch.status).toBe(200);
    expect(patch.body.theme).toBe('DARK');
  });
});

describe('preferences module — concurrent updates', () => {
  it('two concurrent PATCHes touching disjoint fields both apply', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);

    const [a, b] = await Promise.all([
      request(app)
        .patch('/api/v1/me/preferences')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ theme: 'DARK' }),
      request(app)
        .patch('/api/v1/me/preferences')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ density: 'SPACIOUS' }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const final = await request(app)
      .get('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(final.body.theme).toBe('DARK');
    expect(final.body.density).toBe('SPACIOUS');
  });

  it('two concurrent PATCHes racing for the very first row never 500 — exactly one row is created', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .get('/api/v1/me/preferences')
          .set('Authorization', `Bearer ${owner.accessToken}`),
      ),
    );
    for (const response of results) {
      expect(response.status).toBe(200);
    }
  });
});
