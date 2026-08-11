import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withoutTenantScope } from '../../src/core/prisma';
import { buildApp } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';
import { cookieHeader, extractRefreshTokenCookie } from '../support/http';

beforeEach(async () => {
  await resetDatabase();
});

describe('invitation flow', () => {
  it('an OWNER can invite, the invitee can accept, and gets the invited role', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const createResponse = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'new-dispatcher@example.com', role: 'DISPATCHER' });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.inviteToken).toEqual(expect.any(String));
    const inviteToken = createResponse.body.inviteToken as string;

    const acceptResponse = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: inviteToken,
      password: 'a-perfectly-good-password',
      firstName: 'Grace',
      lastName: 'Hopper',
    });

    expect(acceptResponse.status).toBe(201);
    expect(acceptResponse.body.organization.id).toBe(owner.organizationId);
    expect(acceptResponse.body.membership.role).toBe('DISPATCHER');

    const invitation = await withoutTenantScope(
      'Test assertion verifying persisted invitation state directly — no request context exists in test code.',
      (client) =>
        client.invitation.findFirstOrThrow({ where: { email: 'new-dispatcher@example.com' } }),
    );
    expect(invitation.status).toBe('ACCEPTED');
  });

  it('under concurrent accept requests for the same invitation, exactly one succeeds and no request 500s', async () => {
    // Regression test for a bug found via chaos testing: acceptInvitation's
    // up-front existingUser check is a courtesy, not a guarantee — 20
    // concurrent accept requests for the same invitation token all pass it
    // before any of them commits. Confirmed empirically: the losing
    // requests' tx.user.create hit User.email's unique constraint and the
    // resulting Prisma P2002 error, uncaught, surfaced as a raw 500 instead
    // of a clean conflict response (data integrity was never at risk — the
    // unique constraint did its job — but the HTTP-level failure mode was
    // wrong). The fix catches P2002 around that transaction and translates
    // it to the same ConflictError the non-concurrent duplicate path
    // already returns.
    const app = buildApp();
    const owner = await registerOrganization(app);

    const createResponse = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'race-invitee@example.com', role: 'DISPATCHER' });
    const inviteToken = createResponse.body.inviteToken as string;

    const CONCURRENCY = 10;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        request(app)
          .post('/api/v1/auth/accept-invitation')
          .send({
            token: inviteToken,
            password: 'a-perfectly-good-password',
            firstName: 'Racer',
            lastName: `${i}`,
          }),
      ),
    );

    const successes = responses.filter((r) => r.status === 201);
    const serverErrors = responses.filter((r) => r.status >= 500);
    expect(successes).toHaveLength(1);
    expect(serverErrors).toHaveLength(0);

    const userCount = await withoutTenantScope(
      'Test assertion verifying no duplicate user was created under the race — no request context exists in test code.',
      (client) => client.user.count({ where: { email: 'race-invitee@example.com' } }),
    );
    expect(userCount).toBe(1);
  });

  it('rejects accepting an invitation twice', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const createResponse = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'once-only@example.com', role: 'VIEWER' });
    const inviteToken = createResponse.body.inviteToken as string;

    const acceptPayload = {
      token: inviteToken,
      password: 'a-perfectly-good-password',
      firstName: 'Once',
      lastName: 'Only',
    };
    const firstAccept = await request(app)
      .post('/api/v1/auth/accept-invitation')
      .send(acceptPayload);
    expect(firstAccept.status).toBe(201);

    const secondAccept = await request(app)
      .post('/api/v1/auth/accept-invitation')
      .send(acceptPayload);
    expect(secondAccept.status).toBe(401);
  });

  it('rejects an unknown/garbage invitation token', async () => {
    const app = buildApp();
    const response = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: 'this-token-was-never-issued',
      password: 'a-perfectly-good-password',
      firstName: 'Nobody',
      lastName: 'Real',
    });
    expect(response.status).toBe(401);
  });

  it('a revoked invitation can no longer be accepted', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const createResponse = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'revoked@example.com', role: 'VIEWER' });
    const invitationId = createResponse.body.id as string;
    const inviteToken = createResponse.body.inviteToken as string;

    const revokeResponse = await request(app)
      .delete(`/api/v1/organizations/invitations/${invitationId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(revokeResponse.status).toBe(204);

    const acceptResponse = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: inviteToken,
      password: 'a-perfectly-good-password',
      firstName: 'Revoked',
      lastName: 'Person',
    });
    expect(acceptResponse.status).toBe(401);
  });

  it('does not return the invite token again on list', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'listed@example.com', role: 'VIEWER' });

    const listResponse = await request(app)
      .get('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.invitations).toHaveLength(1);
    expect(listResponse.body.invitations[0].inviteToken).toBeUndefined();
  });
});

describe('member management', () => {
  it('lists members of the organization', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .get('/api/v1/organizations/members')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.members).toHaveLength(1);
    expect(response.body.members[0].role).toBe('OWNER');
  });

  it("lets an OWNER change another member's role", async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const invite = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'promote-me@example.com', role: 'VIEWER' });
    const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: invite.body.inviteToken,
      password: 'a-perfectly-good-password',
      firstName: 'Rising',
      lastName: 'Star',
    });
    const membershipId = accept.body.membership.id as string;

    const updateResponse = await request(app)
      .patch(`/api/v1/organizations/members/${membershipId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ role: 'ADMIN' });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.role).toBe('ADMIN');
  });

  it("cannot demote the organization's last remaining owner", async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .patch(`/api/v1/organizations/members/${owner.membershipId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ role: 'ADMIN' });

    expect(response.status).toBe(409);
  });

  it("cannot remove the organization's last remaining owner", async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .delete(`/api/v1/organizations/members/${owner.membershipId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(409);
  });

  it('allows demoting an owner when a second owner exists', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const invite = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'co-owner@example.com', role: 'OWNER' });
    const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: invite.body.inviteToken,
      password: 'a-perfectly-good-password',
      firstName: 'Co',
      lastName: 'Owner',
    });
    const secondOwnerMembershipId = accept.body.membership.id as string;

    const demoteFirstOwner = await request(app)
      .patch(`/api/v1/organizations/members/${owner.membershipId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ role: 'ADMIN' });

    expect(demoteFirstOwner.status).toBe(200);
    expect(demoteFirstOwner.body.role).toBe('ADMIN');

    // Sanity: the second owner is genuinely a distinct row.
    const membership = await withoutTenantScope(
      'Test assertion verifying persisted membership state directly — no request context exists in test code.',
      (client) => client.membership.findUniqueOrThrow({ where: { id: secondOwnerMembershipId } }),
    );
    expect(membership.role).toBe('OWNER');
  });

  it('never lets a concurrent double-demote take an organization to zero owners', async () => {
    // Regression test for the most severe bug found in this project's
    // chaos-testing pass: assertNotLastOwner's count() and the eventual
    // update() were separate, unlocked statements. Two concurrent requests
    // demoting two DIFFERENT owners of the same org could each read "2
    // owners, safe" before either committed. Reproduced live 5 times in a
    // row against the running Docker stack — every trial organization ended
    // with zero active owners. The fix takes a row-level lock (`FOR UPDATE`)
    // on every active-owner membership before counting them, so the second
    // concurrent request blocks until the first commits and then correctly
    // sees only one owner left.
    const app = buildApp();
    const owner = await registerOrganization(app);

    const invite = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'second-owner-race@example.com', role: 'OWNER' });
    const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: invite.body.inviteToken,
      password: 'a-perfectly-good-password',
      firstName: 'Second',
      lastName: 'Owner',
    });
    const secondOwnerMembershipId = accept.body.membership.id as string;
    const secondOwnerAccessToken = accept.body.accessToken as string;

    const [demoteFirst, demoteSecond] = await Promise.all([
      request(app)
        .patch(`/api/v1/organizations/members/${owner.membershipId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ role: 'ADMIN' }),
      request(app)
        .patch(`/api/v1/organizations/members/${secondOwnerMembershipId}`)
        .set('Authorization', `Bearer ${secondOwnerAccessToken}`)
        .send({ role: 'ADMIN' }),
    ]);

    const succeeded = [demoteFirst, demoteSecond].filter((r) => r.status === 200);
    const rejected = [demoteFirst, demoteSecond].filter((r) => r.status === 409);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const activeOwners = await withoutTenantScope(
      'Test assertion verifying the organization never reaches zero active owners — no request context exists in test code.',
      (client) =>
        client.membership.count({
          where: { organizationId: owner.organizationId, role: 'OWNER', status: 'ACTIVE' },
        }),
    );
    expect(activeOwners).toBe(1);
  });

  it('removes a non-owner member', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const invite = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'leaving@example.com', role: 'VIEWER' });
    const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: invite.body.inviteToken,
      password: 'a-perfectly-good-password',
      firstName: 'Leaving',
      lastName: 'Soon',
    });
    const membershipId = accept.body.membership.id as string;

    const removeResponse = await request(app)
      .delete(`/api/v1/organizations/members/${membershipId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(removeResponse.status).toBe(204);

    const listResponse = await request(app)
      .get('/api/v1/organizations/members')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(listResponse.body.members).toHaveLength(1); // only the owner remains active
  });
});

describe('access revocation on role change / removal', () => {
  // authenticate.ts trusts an access token's claims for up to JWT_ACCESS_TTL
  // with no per-request database check — updateMemberRole/removeMember
  // (organizations.service.ts) close the resulting staleness window by
  // revoking the membership in Redis, checked on every request after.
  async function inviteAndAccept(app: ReturnType<typeof buildApp>, owner: { accessToken: string }) {
    const invite = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: `revocation-${Date.now()}@example.com`, role: 'VIEWER' });
    const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: invite.body.inviteToken,
      password: 'a-perfectly-good-password',
      firstName: 'Revocable',
      lastName: 'Member',
    });
    return {
      membershipId: accept.body.membership.id as string,
      accessToken: accept.body.accessToken as string,
      refreshTokenCookie: cookieHeader(extractRefreshTokenCookie(accept)),
    };
  }

  it("a member's own already-issued access token stops working the moment their role changes", async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const member = await inviteAndAccept(app, owner);

    const beforeChange = await request(app)
      .get('/api/v1/organizations/members')
      .set('Authorization', `Bearer ${member.accessToken}`);
    expect(beforeChange.status).toBe(200);

    const roleChange = await request(app)
      .patch(`/api/v1/organizations/members/${member.membershipId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ role: 'ADMIN' });
    expect(roleChange.status).toBe(200);

    // The exact same, still-unexpired token — now stale — must be rejected.
    const afterChange = await request(app)
      .get('/api/v1/organizations/members')
      .set('Authorization', `Bearer ${member.accessToken}`);
    expect(afterChange.status).toBe(401);

    // The refresh token is unaffected — the member's next refresh silently
    // picks up the new role instead of forcing a full re-login.
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', member.refreshTokenCookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.membership.role).toBe('ADMIN');

    const afterRefresh = await request(app)
      .get('/api/v1/organizations/members')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(afterRefresh.status).toBe(200);
  });

  it("a removed member's access token stops working immediately, and their refresh token is also rejected", async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const member = await inviteAndAccept(app, owner);

    const removeResponse = await request(app)
      .delete(`/api/v1/organizations/members/${member.membershipId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(removeResponse.status).toBe(204);

    const afterRemoval = await request(app)
      .get('/api/v1/organizations/members')
      .set('Authorization', `Bearer ${member.accessToken}`);
    expect(afterRemoval.status).toBe(401);

    const refreshAttempt = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', member.refreshTokenCookie);
    expect(refreshAttempt.status).toBe(401);
  });

  it('does not revoke a still-live token when a role update is a no-op (same role)', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const member = await inviteAndAccept(app, owner);

    const noOpUpdate = await request(app)
      .patch(`/api/v1/organizations/members/${member.membershipId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ role: 'VIEWER' });
    expect(noOpUpdate.status).toBe(200);

    const stillWorks = await request(app)
      .get('/api/v1/organizations/members')
      .set('Authorization', `Bearer ${member.accessToken}`);
    expect(stillWorks.status).toBe(200);
  });
});

describe('PATCH /api/v1/organizations', () => {
  async function inviteAndAccept(
    app: ReturnType<typeof buildApp>,
    owner: { accessToken: string },
    role: 'ADMIN' | 'DISPATCHER' | 'VIEWER',
  ) {
    const invite = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: `${role.toLowerCase()}@example.com`, role });
    const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: invite.body.inviteToken,
      password: 'a-perfectly-good-password',
      firstName: 'Team',
      lastName: role,
    });
    return accept.body.accessToken as string;
  }

  it('lets an OWNER rename the organization', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .patch('/api/v1/organizations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Renamed Logistics Co' });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Renamed Logistics Co');
    // The slug is deliberately NOT re-derived from the rename — see
    // updateOrganizationRequestSchema's own comment.
    expect(response.body.slug).toBeTruthy();

    const persisted = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(persisted.body.organization.name).toBe('Renamed Logistics Co');
  });

  it('lets an ADMIN rename the organization', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const adminToken = await inviteAndAccept(app, owner, 'ADMIN');

    const response = await request(app)
      .patch('/api/v1/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Renamed By Admin' });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Renamed By Admin');
  });

  it('rejects a DISPATCHER — organization:manage is an OWNER/ADMIN-only tier', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const dispatcherToken = await inviteAndAccept(app, owner, 'DISPATCHER');

    const response = await request(app)
      .patch('/api/v1/organizations')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ name: 'Should Not Work' });

    expect(response.status).toBe(403);
  });

  it('rejects a VIEWER', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const viewerToken = await inviteAndAccept(app, owner, 'VIEWER');

    const response = await request(app)
      .patch('/api/v1/organizations')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Should Not Work' });

    expect(response.status).toBe(403);
  });

  it('rejects a name that is too short', async () => {
    const app = buildApp();
    const owner = await registerOrganization(app);

    const response = await request(app)
      .patch('/api/v1/organizations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'A' });

    expect(response.status).toBe(400);
  });

  it('rejects an unauthenticated request', async () => {
    const app = buildApp();
    const response = await request(app)
      .patch('/api/v1/organizations')
      .send({ name: 'Anonymous Rename' });
    expect(response.status).toBe(401);
  });

  it("never renames another organization — the update is scoped to the caller's own org", async () => {
    const app = buildApp();
    const ownerA = await registerOrganization(app, { organizationName: 'Org A Logistics' });
    const ownerB = await registerOrganization(app, { organizationName: 'Org B Logistics' });

    await request(app)
      .patch('/api/v1/organizations')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ name: 'Renamed A' })
      .expect(200);

    const orgB = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(orgB.body.organization.name).toBe('Org B Logistics');
  });
});

describe('registration produces genuinely separate organizations', () => {
  it('two registrations never collide on slug even with the same organization name', async () => {
    const app = buildApp();
    const name = 'Duplicate Name Logistics';
    const first = await registerOrganization(app, { organizationName: name });
    const second = await registerOrganization(app, { organizationName: name });

    expect(first.organizationId).not.toBe(second.organizationId);

    const orgs = await prisma.organization.findMany({
      where: { id: { in: [first.organizationId, second.organizationId] } },
    });
    const slugs = orgs.map((org) => org.slug);
    expect(new Set(slugs).size).toBe(2);
  });
});
