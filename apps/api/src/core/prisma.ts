import { PrismaClient, type Prisma } from '@prisma/client';
import type { DependencyCheckResult } from './dependency-check';
import { logger } from './logger';
import { getRequestContext } from './request-context';

/**
 * Models that hold organization-owned data and must never be queried
 * without a tenant scope. `User` and `RefreshToken` are deliberately not
 * on this list: they're reached by `userId`/unique-token lookup, not by
 * "list everything in this organization" — there's no meaningful
 * `organizationId` to inject on `RefreshToken`, and injecting one on
 * `User` would conflate a platform identity with a single organization,
 * which is exactly the thing Phase 1 chose Membership to avoid. Every
 * model added in future phases that represents organization-owned data
 * (Ship, Driver, Call, ...) belongs on this list the moment it exists.
 *
 * Phase 2: Ship and Driver both carry a direct organizationId column, so
 * both go on this list. TruckRequirement and DocumentRequirement do NOT —
 * they only carry a shipId, no organizationId of their own, so injecting
 * `organizationId` into their where clause would be a Prisma validation
 * error (not a silently-wrong query, at least — it fails loudly), not a
 * usable scope. Tenant isolation for those two is enforced one layer up,
 * in ships.service.ts: every operation on a ship's requirements first
 * resolves the parent Ship through a tenant-scoped `prisma.ship` query,
 * and only then acts on its requirements via that already-verified ship's
 * id — a client-supplied shipId is never trusted directly.
 *
 * Phase 3: Assignment initially followed TruckRequirement/DocumentRequirement's
 * pattern (no organizationId, ownership resolved by joining through
 * truckRequirement -> ship -> organizationId) — that held up fine for
 * lookups already scoped to one truck requirement or one driver, but the
 * flat cross-ship "call list" view's default query (status=PENDING, no
 * other filter) has no such anchor to join from, and paid for it: the only
 * available access path scaled with an organization's entire historical
 * assignment volume instead of with its currently-pending rows. Assignment
 * now carries its own organizationId (immutable once set — an assignment's
 * parent truckRequirement/ship never moves to a different organization
 * after creation, so there is nothing for it to drift from) and goes on
 * this list like Ship/Driver. AssignmentAttempt is unchanged and still not
 * tenant-scoped — every access to it goes through an already-resolved,
 * already-owned Assignment first (see assignments.service.ts's
 * resolveOwnedAssignment), so it has never needed its own scope.
 */
const TENANT_SCOPED_MODELS = new Set<Prisma.ModelName>([
  'Membership',
  'Invitation',
  'Ship',
  'Driver',
  'Assignment',
  // Unlike AssignmentAttempt/VoiceCallPlacement (deliberately NOT
  // tenant-scoped — every access to those goes through an already-owned
  // Assignment first), a dispatcher's Yellow Zone queue is a direct
  // top-level list/filter query, the same access shape as Ship/Driver —
  // see schema.prisma's YellowZoneItem comment for the full reasoning.
  'YellowZoneItem',
]);

type ScopableArgs = {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
};

// Explicit allowlist of operations that accept a `where` clause, rather
// than an exclusion list — this was the site of a real bug: the previous
// version only merged organizationId into `where` if the caller had
// already provided one. A completely normal "list everything" call like
// `findMany({ orderBy: {...} })` — no `where` at all — silently skipped
// scoping entirely and returned every organization's rows. Defaulting to
// `{}` here means every operation that CAN be scoped always IS, regardless
// of whether the caller happened to pass a `where`.
const WHERE_SCOPED_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

function withOrganizationScope(
  operation: string,
  args: ScopableArgs,
  organizationId: string,
): ScopableArgs {
  const scoped: ScopableArgs = { ...args };

  if (WHERE_SCOPED_OPERATIONS.has(operation)) {
    scoped.where = { ...(scoped.where ?? {}), organizationId };
  }

  if (operation === 'create' && scoped.data && !Array.isArray(scoped.data)) {
    scoped.data = { ...scoped.data, organizationId };
  }

  if (operation === 'createMany' && scoped.data) {
    scoped.data = Array.isArray(scoped.data)
      ? scoped.data.map((item) => ({ ...item, organizationId }))
      : { ...scoped.data, organizationId };
  }

  if (operation === 'upsert') {
    if (scoped.create) {
      scoped.create = { ...scoped.create, organizationId };
    }
    if (scoped.update) {
      scoped.update = { ...scoped.update, organizationId };
    }
  }

  return scoped;
}

const basePrisma = new PrismaClient();

// Prisma Client Extensions (`$extends`), not the deprecated `$use`
// middleware API — see docs/ARCHITECTURE.md §4. Fails closed: getRequestContext()
// throws if called with no bound context, so a tenant-scoped query with no
// tenant context bound errors instead of silently running unscoped.
//
// Convention for service code: prefer `findFirst`/`findFirstOrThrow` over
// `findUnique` on scoped models. Prisma's `findUnique` requires its `where`
// to be built from a genuine unique identifier; merging in `organizationId`
// as an additional filter works for compound-unique lookups but is a sharp
// edge to rely on generally. `findFirst` has no such restriction.
export const prisma = basePrisma.$extends({
  name: 'tenant-scoping',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_SCOPED_MODELS.has(model)) {
          return query(args);
        }

        const { organizationId } = getRequestContext();
        return query(withOrganizationScope(operation, args as ScopableArgs, organizationId));
      },
    },
  },
});

// Prisma Client Extensions change the shape of the transaction-callback
// client just enough that the base `Prisma.TransactionClient` type doesn't
// structurally match it — deriving the type from the actual extended
// client (rather than importing the generic one) is what keeps call sites
// correct instead of fighting the type checker with a cast. Defined once
// here rather than re-derived per service file (it used to be copy-pasted
// identically into ships.service.ts, assignments.service.ts, and
// organizations.service.ts) — one definition, imported everywhere a
// function needs to accept "whichever Prisma client it's given, possibly
// mid-transaction" as a parameter.
export type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Explicit, logged escape hatch from tenant scoping — for the handful of
 * operations that legitimately have to run before any tenant context
 * exists: looking a user up by email at login (we don't know their
 * organization yet — that's the whole point of looking them up), creating
 * the first Membership during organization registration, and resolving an
 * Invitation by its token during acceptance.
 *
 * Deliberately operates on the raw, *unextended* client (passed into `fn`)
 * rather than gating the extended `prisma` client behind an
 * AsyncLocalStorage "bypass" flag. An earlier version worked that way and
 * was empirically unreliable: Prisma's lazy `PrismaPromise`, especially
 * inside `$transaction`, doesn't consistently propagate ALS context
 * through its internal continuations — the bypass flag would intermittently
 * read as unset by the time the extension's hook fired, even though the
 * call site was genuinely inside `withoutTenantScope`. Operating on the raw
 * client sidesteps the question entirely: there is no interception to
 * bypass, so there is nothing for timing to get wrong.
 *
 * Every call site must supply a `reason`, and every use is logged at warn
 * level. This must stay rare — if a new call site reaches for this outside
 * auth/registration/invitation-acceptance, that's a sign the operation
 * should be redesigned to run inside a bound request context instead of
 * bypassing the guarantee.
 */
export async function withoutTenantScope<T>(
  reason: string,
  fn: (client: typeof basePrisma) => Promise<T>,
): Promise<T> {
  logger.warn({ reason }, 'Bypassing tenant scope for this operation');
  return fn(basePrisma);
}

export async function checkDatabaseConnection(): Promise<DependencyCheckResult> {
  try {
    await basePrisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed');
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
}

export async function disconnectPrisma(): Promise<void> {
  await basePrisma.$disconnect();
}
