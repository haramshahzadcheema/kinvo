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
  | 'drivers:manage'
  | 'yellow-zone:read'
  | 'yellow-zone:manage'
  | 'reminders:read'
  | 'reminders:manage';

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
// standalone screen), so ships:manage covers them. Assignment (Phase 3)
// is the same shape of sub-resource — a driver's engagement with a truck
// requirement — and reuses ships:read/ships:manage for the same reason,
// even though its API surface is a flat top-level resource rather than a
// nested one (see assignments.routes.ts for why).
const LOGISTICS_ACTIONS: readonly Action[] = [
  'ships:read',
  'ships:manage',
  'drivers:read',
  'drivers:manage',
];

// Phase 5's Yellow Zone gets its own action pair rather than folding into
// LOGISTICS_ACTIONS — resolving an escalation is a distinct capability
// from managing ships/drivers (ARCHITECTURE.md §7 names it separately:
// "DISPATCHER... resolve Yellow Zone"), and a future role split (e.g. a
// read-only auditor who can see ships but shouldn't claim escalations)
// shouldn't require re-deriving it out of a bundle it was never
// conceptually part of.
const YELLOW_ZONE_ACTIONS: readonly Action[] = ['yellow-zone:read', 'yellow-zone:manage'];

// Reminders (Phase D) gets its own action pair, same reasoning as
// YELLOW_ZONE_ACTIONS — creating/approving a reminder campaign is a
// distinct capability from managing ships/drivers, and any manage-capable
// role can act on any campaign (mirrors Yellow Zone's claim/resolve model:
// ownership is tracked for accountability, not used to restrict who can
// act — see the ReminderCampaign comment in schema.prisma).
const REMINDER_ACTIONS: readonly Action[] = ['reminders:read', 'reminders:manage'];

const PERMISSIONS: Record<Role, ReadonlySet<Action>> = {
  OWNER: new Set([
    ...ORGANIZATION_MANAGEMENT_ACTIONS,
    ...LOGISTICS_ACTIONS,
    ...YELLOW_ZONE_ACTIONS,
    ...REMINDER_ACTIONS,
  ]),
  ADMIN: new Set([
    ...ORGANIZATION_MANAGEMENT_ACTIONS,
    ...LOGISTICS_ACTIONS,
    ...YELLOW_ZONE_ACTIONS,
    ...REMINDER_ACTIONS,
  ]),
  // DISPATCHER is the primary persona for ships/drivers AND Yellow Zone
  // resolution (ARCHITECTURE.md §7) — full manage access on both, but
  // still read-only on org membership.
  DISPATCHER: new Set<Action>([
    'members:read',
    ...LOGISTICS_ACTIONS,
    ...YELLOW_ZONE_ACTIONS,
    ...REMINDER_ACTIONS,
  ]),
  VIEWER: new Set<Action>([
    'members:read',
    'ships:read',
    'drivers:read',
    'yellow-zone:read',
    'reminders:read',
  ]),
};

export function hasPermission(role: Role, action: Action): boolean {
  return PERMISSIONS[role].has(action);
}
