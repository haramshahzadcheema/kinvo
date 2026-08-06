import { describe, expect, it } from 'vitest';
import { hasPermission } from '../../src/core/rbac/permissions';

describe('rbac permissions', () => {
  it.each(['OWNER', 'ADMIN'] as const)('%s can manage members and invitations', (role) => {
    expect(hasPermission(role, 'members:read')).toBe(true);
    expect(hasPermission(role, 'members:manage')).toBe(true);
    expect(hasPermission(role, 'invitations:read')).toBe(true);
    expect(hasPermission(role, 'invitations:create')).toBe(true);
    expect(hasPermission(role, 'invitations:revoke')).toBe(true);
  });

  it.each(['DISPATCHER', 'VIEWER'] as const)(
    '%s can read members but cannot manage members or invitations',
    (role) => {
      expect(hasPermission(role, 'members:read')).toBe(true);
      expect(hasPermission(role, 'members:manage')).toBe(false);
      expect(hasPermission(role, 'invitations:read')).toBe(false);
      expect(hasPermission(role, 'invitations:create')).toBe(false);
      expect(hasPermission(role, 'invitations:revoke')).toBe(false);
    },
  );

  it.each(['OWNER', 'ADMIN', 'DISPATCHER'] as const)('%s can manage ships and drivers', (role) => {
    expect(hasPermission(role, 'ships:read')).toBe(true);
    expect(hasPermission(role, 'ships:manage')).toBe(true);
    expect(hasPermission(role, 'drivers:read')).toBe(true);
    expect(hasPermission(role, 'drivers:manage')).toBe(true);
  });

  it('VIEWER can read ships and drivers but cannot manage them', () => {
    expect(hasPermission('VIEWER', 'ships:read')).toBe(true);
    expect(hasPermission('VIEWER', 'ships:manage')).toBe(false);
    expect(hasPermission('VIEWER', 'drivers:read')).toBe(true);
    expect(hasPermission('VIEWER', 'drivers:manage')).toBe(false);
  });
});
