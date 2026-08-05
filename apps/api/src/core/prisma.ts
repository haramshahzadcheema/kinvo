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
 */
const TENANT_SCOPED_MODELS = new Set<Prisma.ModelName>(['Membership', 'Invitation']);

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
