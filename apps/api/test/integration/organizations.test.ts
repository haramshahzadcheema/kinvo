import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withoutTenantScope } from '../../src/core/prisma';
import { buildApp } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';

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
