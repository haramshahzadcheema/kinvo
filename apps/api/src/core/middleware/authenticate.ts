import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../errors/AppError';
import { runWithRequestContext, type RequestContext } from '../request-context';
import { InvalidAccessTokenError, verifyAccessToken } from '../security/tokens';

/**
 * Verifies the bearer access token, resolves the Current Context from its
 * (already-verified) claims, attaches it to `req.context`, and binds it to
 * AsyncLocalStorage for the rest of the request — this is what makes the
 * Prisma tenant-scoping extension work without every service having to
 * thread `organizationId` through as an explicit parameter.
 *
 * Deliberately does not hit the database to re-resolve role/membership on
 * every request — the access token's short TTL (JWT_ACCESS_TTL) is the
 * bound on how stale a claim can be after e.g. a role change; the tradeoff
 * is documented, not accidental.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  if (!token) {
    next(new UnauthorizedError('Missing access token.'));
    return;
  }

  let context: RequestContext;
  try {
    const payload = verifyAccessToken(token);
    context = {
      userId: payload.sub,
      organizationId: payload.organizationId,
      membershipId: payload.membershipId,
      role: payload.role,
    };
  } catch (error) {
    if (error instanceof InvalidAccessTokenError) {
      next(new UnauthorizedError('Invalid or expired access token.'));
      return;
    }
    next(error);
    return;
  }

  req.context = context;
  runWithRequestContext(context, next);
};
