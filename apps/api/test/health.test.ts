import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';

const { checkDatabaseConnection, checkRedisConnection } = vi.hoisted(() => ({
  checkDatabaseConnection: vi.fn(),
  checkRedisConnection: vi.fn(),
}));

vi.mock('../src/core/database', () => ({
  pool: { end: vi.fn() },
  checkDatabaseConnection,
}));

vi.mock('../src/core/redis', () => ({
  redis: { disconnect: vi.fn() },
  checkRedisConnection,
}));

beforeEach(() => {
  checkDatabaseConnection.mockReset().mockResolvedValue({ ok: true });
  checkRedisConnection.mockReset().mockResolvedValue({ ok: true });
});

describe('GET /health/live', () => {
  it('returns 200 with status ok without checking dependencies', async () => {
    const app = createApp();
    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(checkDatabaseConnection).not.toHaveBeenCalled();
    expect(checkRedisConnection).not.toHaveBeenCalled();
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when all dependencies are healthy', async () => {
    const app = createApp();
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.dependencies).toHaveLength(2);
  });

  it('returns 503 with dependency detail when the database is unreachable', async () => {
    checkDatabaseConnection.mockResolvedValue({ ok: false, error: 'connection refused' });

    const app = createApp();
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('error');
    expect(response.body.dependencies).toContainEqual(
      expect.objectContaining({ name: 'postgres', status: 'error', error: 'connection refused' }),
    );
  });
});

describe('unmatched routes', () => {
  it('returns a structured 404 error envelope', async () => {
    const app = createApp();
    const response = await request(app).get('/definitely-not-a-route');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });
});
