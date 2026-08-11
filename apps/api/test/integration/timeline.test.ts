import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildAppWithContainer } from '../support/app';
import { resetDatabase } from '../support/db';
import { registerOrganization } from '../support/fixtures';

beforeEach(async () => {
  await resetDatabase();
});

async function inviteViewer(app: ReturnType<typeof buildAppWithContainer>['app'], owner: { accessToken: string }) {
  const invite = await request(app)
    .post('/api/v1/organizations/invitations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ email: 'viewer@example.com', role: 'VIEWER' });
  const accept = await request(app)
    .post('/api/v1/auth/accept-invitation')
    .send({
      token: invite.body.inviteToken,
      firstName: 'Vi',
      lastName: 'Ewer',
      password: 'correct-horse-battery-staple',
    });
  return accept.body.accessToken as string;
}

describe('timeline module — document requirement audit events', () => {
  it('records document.added when a document requirement is created on a ship', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const ship = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipName: 'MSC Aurora' })
      .expect(201);

    await request(app)
      .post(`/api/v1/ships/${ship.body.id}/document-requirements`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ documentType: 'Bill of Lading', isRequired: true })
      .expect(201);

    const timeline = await request(app)
      .get('/api/v1/timeline')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const entry = timeline.body.items.find((e: { type: string }) => e.type === 'document.added');
    expect(entry).toBeDefined();
    expect(entry.title).toBe('Document Requirement Added');
    expect(entry.detail).toBe('MSC Aurora — Bill of Lading');
    expect(entry.actorName).toBe('Ada Lovelace');
  });

  it('records document.updated and document.removed', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const ship = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipName: 'MSC Aurora' })
      .expect(201);
    const doc = await request(app)
      .post(`/api/v1/ships/${ship.body.id}/document-requirements`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ documentType: 'Bill of Lading', isRequired: true })
      .expect(201);

    await request(app)
      .patch(`/api/v1/ships/${ship.body.id}/document-requirements/${doc.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ isRequired: false })
      .expect(200);
    await request(app)
      .delete(`/api/v1/ships/${ship.body.id}/document-requirements/${doc.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    const timeline = await request(app)
      .get('/api/v1/timeline')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const types = timeline.body.items.map((e: { type: string }) => e.type);
    expect(types).toContain('document.updated');
    expect(types).toContain('document.removed');
  });
});

describe('timeline module — feed contents', () => {
  it('is newest-first and reflects a real ship-creation event', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipName: 'MSC Aurora' })
      .expect(201);
    await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipName: 'CMA Zeus' })
      .expect(201);

    const timeline = await request(app)
      .get('/api/v1/timeline')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const createdEntries = timeline.body.items.filter(
      (e: { type: string }) => e.type === 'ship.created',
    );
    expect(createdEntries).toHaveLength(2);
    // Newest first: CMA Zeus was created second.
    expect(createdEntries[0].detail).toBe('CMA Zeus');
    expect(createdEntries[1].detail).toBe('MSC Aurora');
  });

  it('excludes account-plumbing events (auth/invitation/membership) from the operational feed', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    // registerOrganization itself triggers auth.register_organization, and
    // this invite triggers invitation.sent — neither should ever surface.
    await request(app)
      .post('/api/v1/organizations/invitations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'someone@example.com', role: 'VIEWER' })
      .expect(201);

    const timeline = await request(app)
      .get('/api/v1/timeline')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const types = timeline.body.items.map((e: { type: string }) => e.type);
    expect(types).not.toContain('auth.register_organization');
    expect(types).not.toContain('invitation.sent');
  });

  it('resolves a real shipName for a ship still shown after a status change', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const ship = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipName: 'MSC Aurora' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/ships/${ship.body.id}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'RECRUITING' })
      .expect(200);

    const timeline = await request(app)
      .get('/api/v1/timeline')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const entry = timeline.body.items.find(
      (e: { type: string }) => e.type === 'ship.status_changed',
    );
    expect(entry.detail).toBe('MSC Aurora');
  });

  it('still shows a shipName for ship.deleted after the ship row is gone', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const ship = await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ shipName: 'MSC Aurora' })
      .expect(201);

    await request(app)
      .delete(`/api/v1/ships/${ship.body.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    const timeline = await request(app)
      .get('/api/v1/timeline')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const entry = timeline.body.items.find((e: { type: string }) => e.type === 'ship.deleted');
    expect(entry.detail).toBe('MSC Aurora');
  });

  it('paginates', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post('/api/v1/ships')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ shipName: `Ship ${i}` })
        .expect(201);
    }

    const firstPage = await request(app)
      .get('/api/v1/timeline?page=1&pageSize=2')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.total).toBe(3);
    expect(firstPage.body.totalPages).toBe(2);
  });
});

describe('timeline module — tenant isolation and RBAC', () => {
  it('org A cannot see org B events', async () => {
    const { app } = buildAppWithContainer();
    const ownerA = await registerOrganization(app);
    await request(app)
      .post('/api/v1/ships')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ shipName: 'MSC Aurora' })
      .expect(201);

    const ownerB = await registerOrganization(app);
    const timeline = await request(app)
      .get('/api/v1/timeline')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(200);
    expect(timeline.body.items).toHaveLength(0);
  });

  it('a VIEWER can read the timeline', async () => {
    const { app } = buildAppWithContainer();
    const owner = await registerOrganization(app);
    const viewerToken = await inviteViewer(app, owner);

    await request(app)
      .get('/api/v1/timeline')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
  });

  it('requires authentication', async () => {
    const { app } = buildAppWithContainer();
    await request(app).get('/api/v1/timeline').expect(401);
  });
});
