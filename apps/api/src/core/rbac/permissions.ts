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
  | 'invitations:revoke'
  | 'ships:read'
  | 'ships:manage'
  | 'drivers:read'
  | 'drivers:manage';

const ORGANIZATION_MANAGEMENT_ACTIONS: readonly Action[] = [
  'members:read',
  'members:manage',
  'invitations:read',
  'invitations:create',
  'invitations:revoke',
];

// Truck/document requirements aren't separately permissioned — they're
// sub-resources only ever edited as part of a ship record (matching the
// actual UI, where destinations are fields on the "Add Ship" form, not a
// standalone screen), so ships:manage covers them.
const LOGISTICS_ACTIONS: readonly Action[] = [
  'ships:read',
  'ships:manage',
  'drivers:read',
  'drivers:manage',
];

const PERMISSIONS: Record<Role, ReadonlySet<Action>> = {
  OWNER: new Set([...ORGANIZATION_MANAGEMENT_ACTIONS, ...LOGISTICS_ACTIONS]),
  ADMIN: new Set([...ORGANIZATION_MANAGEMENT_ACTIONS, ...LOGISTICS_ACTIONS]),
  // DISPATCHER is the primary persona for ships/drivers (ARCHITECTURE.md
  // §7) — full manage access there, but still read-only on org membership.
  DISPATCHER: new Set<Action>(['members:read', ...LOGISTICS_ACTIONS]),
  VIEWER: new Set<Action>(['members:read', 'ships:read', 'drivers:read']),
};

export function hasPermission(role: Role, action: Action): boolean {
  return PERMISSIONS[role].has(action);
}
