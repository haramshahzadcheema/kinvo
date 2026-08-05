import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RoleValue } from '@kinvo/contracts';
import { buildApp } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';

beforeEach(async () => {
  await resetDatabase();
});

async function acceptAsRole(
  app: ReturnType<typeof buildApp>,
  ownerAccessToken: string,
  role: RoleValue,
  email: string,
): Promise<string> {
  const invite = await request(app)
    .post('/api/v1/organizations/invitations')
    .set('Authorization', `Bearer ${ownerAccessToken}`)
    .send({ email, role });

  const accept = await request(app).post('/api/v1/auth/accept-invitation').send({
    token: invite.body.inviteToken,
    password: 'a-perfectly-good-password',
    firstName: 'Test',
    lastName: role,
  });

  return accept.body.accessToken as string;
}

describe('RBAC — members:read', () => {
  it.each<RoleValue>(['OWNER', 'ADMIN', 'DISPATCHER', 'VIEWER'])(
    '%s can list members',
    async (role) => {
      const app = buildApp();
      const owner = await registerOrganization(app);
      const accessToken =
        role === 'OWNER'
          ? owner.accessToken
          : await acceptAsRole(app, owner.accessToken, role, `${role}@example.com`);

      const response = await request(app)
        .get('/api/v1/organizations/members')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
    },
  );
});

describe('RBAC — invitations:create', () => {
  it.each<RoleValue>(['OWNER', 'ADMIN'])('%s can create invitations', async (role) => {
    const app = buildApp();
    const owner = await registerOrganization(app);
    const accessToken =
      role === 'OWNER'
        ? owner.accessToken
        : await acceptAsRole(app, owner.accessToken, role, `${role}@example.com`);

    const response = await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: 'someone-new@example.com', role: 'VIEWER' });

    expect(response.status).toBe(201);
  });

  it.each<RoleValue>(['DISPATCHER', 'VIEWER'])(
    '%s is forbidden from creating invitations',
    async (role) => {
      const app = buildApp();
      const owner = await registerOrganization(app);
      const accessToken = await acceptAsRole(app, owner.accessToken, role, `${role}@example.com`);

      const response = await request(app)
        .post('/api/v1/organizations/invitations')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ email: 'someone-new@example.com', role: 'VIEWER' });

      expect(response.status).toBe(403);
    },
  );
});

describe('RBAC — members:manage', () => {
  it.each<RoleValue>(['DISPATCHER', 'VIEWER'])(
    "%s is forbidden from changing a member's role",
    async (role) => {
      const app = buildApp();
      const owner = await registerOrganization(app);
      const accessToken = await acceptAsRole(app, owner.accessToken, role, `${role}@example.com`);

      const response = await request(app)
        .patch(`/api/v1/organizations/members/${owner.membershipId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(403);
    },
  );

  it.each<RoleValue>(['DISPATCHER', 'VIEWER'])(
    '%s is forbidden from removing a member',
    async (role) => {
      const app = buildApp();
      const owner = await registerOrganization(app);
      const accessToken = await acceptAsRole(app, owner.accessToken, role, `${role}@example.com`);

      const response = await request(app)
        .delete(`/api/v1/organizations/members/${owner.membershipId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(403);
    },
  );
});
