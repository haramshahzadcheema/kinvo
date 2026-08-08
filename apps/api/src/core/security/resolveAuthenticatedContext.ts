import { UnauthorizedError } from '../errors/AppError';
import type { RequestContext } from '../request-context';
import type { TokenRevocationStore } from './token-revocation';
import { InvalidAccessTokenError, verifyAccessToken } from './tokens';

/**
 * The one place a bearer access token becomes a verified Current Context —
 * shared by `authenticate.ts` (REST) and `core/realtime/socketServer.ts`
 * (Socket.io handshake) so the two auth surfaces can never drift on what
 * "authenticated" means. `organizationId` always comes from here, from the
 * token's own verified claims — never accepted as a client-supplied value
 * on either surface.
 *
 * Throws `UnauthorizedError` for every failure case (missing/invalid/
 * expired token, revoked membership) — callers translate that into
 * whatever their transport needs (a 401 response, a rejected socket
 * handshake).
 */
export async function resolveAuthenticatedContext(
  token: string | undefined,
  tokenRevocationStore: TokenRevocationStore,
): Promise<RequestContext> {
  if (!token) {
    throw new UnauthorizedError('Missing access token.');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    if (error instanceof InvalidAccessTokenError) {
      throw new UnauthorizedError('Invalid or expired access token.');
    }
    throw error;
  }

  const isRevoked = await tokenRevocationStore.isTokenRevoked(
    payload.membershipId,
    payload.issuedAtMs,
  );
  if (isRevoked) {
    throw new UnauthorizedError('Your access has changed. Please sign in again.');
  }

  return {
    userId: payload.sub,
    organizationId: payload.organizationId,
    membershipId: payload.membershipId,
    role: payload.role,
  };
}
