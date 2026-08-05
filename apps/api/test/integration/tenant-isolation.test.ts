import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';

// This is the test Phase 0's audit (finding C3) explicitly required before
// multi-tenancy could be considered proven rather than merely documented:
// a request authenticated for one organization must never be able to
// read or write another organization's data — even when it holds a
// perfectly valid, real (just not "its own") resource ID.
//
// The mechanism under test is the Prisma tenant-scoping extension
// (core/prisma.ts) auto-injecting organizationId from the AsyncLocalStorage
// request context into every query against a scoped model. If a developer
// forgets a `where: { organizationId }` clause by hand, this suite is what
// catches it — not a code review.

beforeEach(async () => {
  await resetDatabase();
});

describe('cross-tenant isolation', () => {
  it("org A's member list never includes org B's members", async () => {
    const app = buildApp();
    const orgA = await registerOrganization(app);
    const orgB = await registerOrganization(app);

    const listAsA = await request(app)
      .get('/api/v1/organizations/members')
      .set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(listAsA.status).toBe(200);
    expect(listAsA.body.members).toHaveLength(1);
    expect(listAsA.body.members[0].userId).toBe(orgA.userId);
    expect(listAsA.body.members[0].userId).not.toBe(orgB.userId);
  });

  it("org A cannot read org B's membership by ID — it's invisible, not forbidden", async () => {
    const app = buildApp();
    const orgA = await registerOrganization(app);
    const orgB = await registerOrganization(app);

    // orgB.membershipId is a real, valid row — just not org A's.
    const response = await request(app)
      .patch(`/api/v1/organizations/members/${orgB.membershipId}`)
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ role: 'ADMIN' });

    // 404, not 403: the auto-scoped query genuinely cannot find the row,
    // rather than finding it and then rejecting on a permission check.
    // That distinction is the whole point — there is no code path where
    // org A's request handler ever sees org B's row at all.
    expect(response.status).toBe(404);
  });

  it("org A cannot delete (remove) org B's membership", async () => {
    const app = buildApp();
    const orgA = await registerOrganization(app);
    const orgB = await registerOrganization(app);

    const response = await request(app)
      .delete(`/api/v1/organizations/members/${orgB.membershipId}`)
      .set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(response.status).toBe(404);

    // And org B's membership must be completely untouched.
    const orgBMembers = await request(app)
      .get('/api/v1/organizations/members')
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(orgBMembers.body.members).toHaveLength(1);
    expect(orgBMembers.body.members[0].status).toBe('ACTIVE');
  });

  it("org A cannot see or revoke org B's invitations", async () => {
    const app = buildApp();
    const orgA = await registerOrganization(app);
    const orgB = await registerOrganization(app);

    const invitationInB = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ email: 'belongs-to-org-b@example.com', role: 'VIEWER' });
    const invitationId = invitationInB.body.id as string;

    const listAsA = await request(app)
      .get('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${orgA.accessToken}`);
    expect(listAsA.body.invitations).toHaveLength(0);

    const revokeAsA = await request(app)
      .delete(`/api/v1/organizations/invitations/${invitationId}`)
      .set('Authorization', `Bearer ${orgA.accessToken}`);
    expect(revokeAsA.status).toBe(404);

    // The invitation must still be usable — org A's attempt had no effect.
    const listAsB = await request(app)
      .get('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(listAsB.body.invitations).toHaveLength(1);
    expect(listAsB.body.invitations[0].status).toBe('PENDING');
  });

  it('an invitation issued by org A can only be accepted into org A, never org B', async () => {
    const app = buildApp();
    const orgA = await registerOrganization(app);
    await registerOrganization(app); // org B exists but is otherwise unused here

    const invite = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ email: 'joins-org-a@example.com', role: 'DISPATCHER' });

    const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
      token: invite.body.inviteToken,
      password: 'a-perfectly-good-password',
      firstName: 'Joins',
      lastName: 'OrgA',
    });

    expect(accept.status).toBe(201);
    expect(accept.body.organization.id).toBe(orgA.organizationId);
  });
});
