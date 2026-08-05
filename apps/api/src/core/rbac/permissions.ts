import type { Role } from '@prisma/client';

/**
 * Fixed roles, code-level declarative permission map — not a dynamic,
 * DB-driven permission system. Four roles don't justify that complexity;
 * see docs/ARCHITECTURE.md's RBAC section for why this was a deliberate
 * choice, not a shortcut.
 *
 * OWNER and ADMIN carry identical permissions here — the only place they
 * currently diverge is the last-OWNER protection in organizations.service.ts
 * (an org must always retain at least one OWNER). Billing/org-settings
 * access is the other place ARCHITECTURE.md §7 says they should diverge,
 * but billing doesn't exist yet, so there's nothing to encode for it.
 */
export type Action =
  | 'members:read'
  | 'members:manage'
  | 'invitations:read'
  | 'invitations:create'
  | 'invitations:revoke';

const ORGANIZATION_MANAGEMENT_ACTIONS: readonly Action[] = [
  'members:read',
  'members:manage',
  'invitations:read',
  'invitations:create',
  'invitations:revoke',
];

const PERMISSIONS: Record<Role, ReadonlySet<Action>> = {
  OWNER: new Set(ORGANIZATION_MANAGEMENT_ACTIONS),
  ADMIN: new Set(ORGANIZATION_MANAGEMENT_ACTIONS),
  DISPATCHER: new Set<Action>(['members:read']),
  VIEWER: new Set<Action>(['members:read']),
};

export function hasPermission(role: Role, action: Action): boolean {
  return PERMISSIONS[role].has(action);
}
