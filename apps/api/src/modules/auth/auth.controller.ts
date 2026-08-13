import type {
  AcceptInvitationRequest,
  AuthResponse,
  LoginRequest,
  RegisterOrganizationRequest,
  UpdateMeRequest,
} from '@kinvo/contracts';
import type { Request, RequestHandler, Response } from 'express';
import { env } from '../../config/env';
import { UnauthorizedError } from '../../core/errors/AppError';
import type { AuthResult, AuthService, RequestMeta } from './auth.service';

const REFRESH_TOKEN_COOKIE_PATH = '/api/v1/auth';

// 'strict' in dev/test: web and api are same-site there (SameSite only
// cares about scheme+eTLD+1, not port — localhost:5173 and localhost:4000
// are the same site), so the stricter setting costs nothing locally.
// 'none' in production: web and api are deployed as separate services on
// unrelated hosts (e.g. Railway's *.up.railway.app subdomains are each
// their own site per the public suffix list), and SameSite=Strict/Lax
// cookies are never sent on that kind of cross-site fetch — refresh would
// silently fail every time. 'None' requires `Secure`, which is already
// tied to the same NODE_ENV check just below, so the two never disagree.
// CORS_ORIGIN still allowlists exactly one origin (see app.ts), which is
// what actually bounds the CSRF exposure this trades away: an attacker's
// page can trigger this cookie's use, but Origin-restricted CORS + the
// separate in-memory access token (never in a cookie) keep it from
// reaching any real business endpoint.
const REFRESH_COOKIE_SAME_SITE = env.NODE_ENV === 'production' ? 'none' : 'strict';

function setRefreshTokenCookie(res: Response, rawRefreshToken: string): void {
  res.cookie(env.REFRESH_TOKEN_COOKIE_NAME, rawRefreshToken, {
    httpOnly: true,
    // Secure cookies are silently dropped by browsers over plain
    // http://localhost — hardcoding `true` here would make local login
    // look broken for no obvious reason.
    secure: env.NODE_ENV === 'production',
    sameSite: REFRESH_COOKIE_SAME_SITE,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: REFRESH_TOKEN_COOKIE_PATH,
  });
}

function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(env.REFRESH_TOKEN_COOKIE_NAME, {
    path: REFRESH_TOKEN_COOKIE_PATH,
    secure: env.NODE_ENV === 'production',
    sameSite: REFRESH_COOKIE_SAME_SITE,
  });
}

function requestMeta(req: Request): RequestMeta {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

function getRefreshTokenCookie(req: Request): string | undefined {
  return (req.cookies as Record<string, string> | undefined)?.[env.REFRESH_TOKEN_COOKIE_NAME];
}

// Built explicitly, not by destructuring-and-discarding `refreshToken` —
// that value must never appear in a JSON response body under any
// refactor; being explicit about what IS included is the safer default.
function toAuthResponseBody(result: AuthResult): AuthResponse {
  return {
    accessToken: result.accessToken,
    user: result.user,
    organization: result.organization,
    membership: result.membership,
  };
}

export interface AuthController {
  registerOrganization: RequestHandler;
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
  logoutAll: RequestHandler;
  acceptInvitation: RequestHandler;
  me: RequestHandler;
  updateMe: RequestHandler;
}

export function createAuthController(authService: AuthService): AuthController {
  const registerOrganization: RequestHandler = async (req, res, next) => {
    try {
      const result = await authService.registerOrganization(
        req.body as RegisterOrganizationRequest,
        requestMeta(req),
      );
      setRefreshTokenCookie(res, result.refreshToken);
      res.status(201).json(toAuthResponseBody(result));
    } catch (error) {
      next(error);
    }
  };

  const login: RequestHandler = async (req, res, next) => {
    try {
      const result = await authService.login(req.body as LoginRequest, requestMeta(req));
      setRefreshTokenCookie(res, result.refreshToken);
      res.status(200).json(toAuthResponseBody(result));
    } catch (error) {
      next(error);
    }
  };

  const refresh: RequestHandler = async (req, res, next) => {
    try {
      const rawRefreshToken = getRefreshTokenCookie(req);
      if (!rawRefreshToken) {
        throw new UnauthorizedError('Missing refresh token.');
      }
      const result = await authService.refresh(rawRefreshToken, requestMeta(req));
      setRefreshTokenCookie(res, result.refreshToken);
      res.status(200).json(toAuthResponseBody(result));
    } catch (error) {
      next(error);
    }
  };

  const logout: RequestHandler = async (req, res, next) => {
    try {
      const rawRefreshToken = getRefreshTokenCookie(req);
      if (rawRefreshToken) {
        await authService.logout(rawRefreshToken);
      }
      clearRefreshTokenCookie(res);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  const logoutAll: RequestHandler = async (req, res, next) => {
    try {
      const rawRefreshToken = getRefreshTokenCookie(req);
      if (!rawRefreshToken) {
        throw new UnauthorizedError('Missing refresh token.');
      }
      await authService.logoutAll(rawRefreshToken);
      clearRefreshTokenCookie(res);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  const acceptInvitation: RequestHandler = async (req, res, next) => {
    try {
      const result = await authService.acceptInvitation(
        req.body as AcceptInvitationRequest,
        requestMeta(req),
      );
      setRefreshTokenCookie(res, result.refreshToken);
      res.status(201).json(toAuthResponseBody(result));
    } catch (error) {
      next(error);
    }
  };

  const me: RequestHandler = async (req, res, next) => {
    try {
      if (!req.context) {
        throw new UnauthorizedError('Missing request context.');
      }
      const result = await authService.getMe(req.context);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const updateMe: RequestHandler = async (req, res, next) => {
    try {
      if (!req.context) {
        throw new UnauthorizedError('Missing request context.');
      }
      const result = await authService.updateMe(req.context, req.body as UpdateMeRequest);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  return {
    registerOrganization,
    login,
    refresh,
    logout,
    logoutAll,
    acceptInvitation,
    me,
    updateMe,
  };
}
