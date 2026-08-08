import type { RequestHandler } from 'express';
import { ServiceUnavailableError, UnauthorizedError } from '../errors/AppError';
import { runWithRequestContext } from '../request-context';
import { resolveAuthenticatedContext } from '../security/resolveAuthenticatedContext';
import type { TokenRevocationStore } from '../security/token-revocation';

/**
 * Verifies the bearer access token, resolves the Current Context from its
 * (already-verified) claims, attaches it to `req.context`, and binds it to
 * AsyncLocalStorage for the rest of the request — this is what makes the
 * Prisma tenant-scoping extension work without every service having to
 * thread `organizationId` through as an explicit parameter.
 *
 * Deliberately does not hit the database to re-resolve role/membership on
 * every request — the access token's short TTL (JWT_ACCESS_TTL) is the
 * bound on how stale a claim can be after e.g. a role change. The one gap
 * that bound doesn't cover — a membership revoked or role-changed
 * mid-token-lifetime, where the old token would otherwise stay valid with
 * stale claims until its own `exp` — is closed by the Redis-backed
 * `tokenRevocationStore` check below, not by adding a database round-trip
 * to every request. See `core/security/token-revocation.ts`.
 */
export function createAuthenticateMiddleware(
  tokenRevocationStore: TokenRevocationStore,
): RequestHandler {
  return async (req, _res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

    let context;
    try {
      context = await resolveAuthenticatedContext(token, tokenRevocationStore);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        next(error);
        return;
      }
      // Anything else reaching here is the revocation-check call itself
      // failing (Redis unreachable), not a bad/missing/revoked token.
      // Fails closed, not open: silently skipping the revocation check
      // would mean a role change or member removal stops actually taking
      // effect for up to JWT_ACCESS_TTL — exactly the staleness window
      // this check exists to close. Mapped to 503, matching this app's
      // existing convention for a downstream dependency outage (see
      // errorHandler.ts's PrismaClientInitializationError branch) rather
      // than an opaque 500.
      next(new ServiceUnavailableError('Unable to verify access at this time.', { cause: error }));
      return;
    }

    req.context = context;
    runWithRequestContext(context, next);
  };
}
