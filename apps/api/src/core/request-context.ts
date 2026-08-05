import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@prisma/client';

/**
 * The Current Context: resolved once per request by the `authenticate`
 * middleware from a verified access token, then available for the rest of
 * that request's async call graph — controllers, services, and the Prisma
 * tenant-scoping extension all read from here instead of re-deriving or
 * re-querying any of these values.
 *
 * `organizationId` is the field the multi-tenancy guarantee hinges on — see
 * docs/ARCHITECTURE.md §4 for why shared-schema, row-level scoping was
 * chosen over schema-per-tenant. This module started in Phase 0 as
 * `TenantContext` (organizationId only); Phase 1 widens it to the full
 * authenticated identity now that auth actually exists, per that phase's
 * explicit requirement to expose a Current Context object on every
 * authenticated request.
 */
export interface RequestContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: Role;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` bound for the lifetime of its async call graph. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}

/**
 * Returns the current request context. Throws if called outside of
 * `runWithRequestContext` — deliberately fails closed: code that needs a
 * tenant scope but doesn't have one should error, not silently query
 * unscoped.
 */
export function getRequestContext(): RequestContext {
  const context = requestContextStorage.getStore();
  if (!context) {
    throw new Error('getRequestContext() called outside of a request-scoped context.');
  }
  return context;
}

/** Same as `getRequestContext`, but returns `undefined` instead of throwing. */
export function tryGetRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
