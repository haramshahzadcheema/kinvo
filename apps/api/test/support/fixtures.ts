import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { extractRefreshTokenCookie } from './http';

export function registrationPayload(overrides: Partial<Record<string, string>> = {}) {
  const unique = randomUUID().slice(0, 8);
  return {
    organizationName: `Test Logistics ${unique}`,
    email: `owner-${unique}@example.com`,
    password: 'correct-horse-battery-staple',
    firstName: 'Ada',
    lastName: 'Lovelace',
    ...overrides,
  };
}

export interface RegisteredOrg {
  accessToken: string;
  refreshToken: string;
  organizationId: string;
  membershipId: string;
  userId: string;
  email: string;
  password: string;
}

export async function registerOrganization(
  app: Express,
  overrides: Partial<Record<string, string>> = {},
): Promise<RegisteredOrg> {
  const payload = registrationPayload(overrides);
  const response = await request(app).post('/api/v1/auth/register-organization').send(payload);

  if (response.status !== 201) {
    throw new Error(
      `Test fixture failed to register an organization: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  return {
    accessToken: response.body.accessToken as string,
    refreshToken: extractRefreshTokenCookie(response),
    organizationId: response.body.organization.id as string,
    membershipId: response.body.membership.id as string,
    userId: response.body.user.id as string,
    email: payload.email,
    password: payload.password,
  };
}
