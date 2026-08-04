import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The request-scoped tenant identity. `organizationId` is the ONE thing
 * every query against tenant-owned tables must be scoped by — see
 * docs/ARCHITECTURE.md §4 for why shared-schema, row-level scoping was
 * chosen over schema-per-tenant.
 *
 * This module is infrastructure only: it has no models to enforce yet
 * (Phase 0 has none), and it is not wired into any middleware here. Phase 1
 * wires it up in two places once the first models exist:
 *   1. An auth middleware calls `runWithTenantContext()` once per request,
 *      using the `organizationId` claim out of the verified JWT.
 *   2. A Prisma `$use` middleware calls `getTenantContext()` and injects
 *      `organizationId` into every query's `where` clause automatically,
 *      so a developer forgetting to scope a query fails closed instead of
 *      leaking cross-tenant data.
 * Building the primitive now — independent of models — means Phase 1 has
 * a tested building block to wire up, not a blank page.
 */
export interface TenantContext {
  organizationId: string;
}

const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

/** Runs `fn` with `context` bound for the lifetime of its async call graph. */
export function runWithTenantContext<T>(context: TenantContext, fn: () => T): T {
  return tenantContextStorage.run(context, fn);
}

/**
 * Returns the current tenant context. Throws if called outside of
 * `runWithTenantContext` — deliberately fails closed: code that needs a
 * tenant scope but doesn't have one should error, not silently query
 * unscoped.
 */
export function getTenantContext(): TenantContext {
  const context = tenantContextStorage.getStore();
  if (!context) {
    throw new Error('getTenantContext() called outside of a tenant-scoped request context.');
  }
  return context;
}

/** Same as `getTenantContext`, but returns `undefined` instead of throwing. */
export function tryGetTenantContext(): TenantContext | undefined {
  return tenantContextStorage.getStore();
}
