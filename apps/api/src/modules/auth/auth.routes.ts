import {
  acceptInvitationRequestSchema,
  loginRequestSchema,
  registerOrganizationRequestSchema,
} from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validateBody } from '../../core/middleware/validate';
import { createAuthController } from './auth.controller';
import type { AuthService } from './auth.service';

export function createAuthRouter(authService: AuthService, authenticate: RequestHandler): Router {
  const router = Router();
  const controller = createAuthController(authService);

  // Stricter than the general API rate limit: auth endpoints are the
  // classic credential-stuffing/brute-force target. Created fresh per
  // router instance, not at module scope — a module-scoped limiter would
  // be shared and accumulate state across every `createAuthRouter()` call
  // in the process. Harmless in production (the router is built exactly
  // once), but it silently broke test isolation: every test calling
  // buildApp() was hitting the same limiter instance and counting against
  // the same window as every other test in the run.
  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  });
  router.use(authRateLimiter);

  router.post(
    '/register-organization',
    validateBody(registerOrganizationRequestSchema),
    controller.registerOrganization,
  );
  router.post('/login', validateBody(loginRequestSchema), controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.post('/logout-all', controller.logoutAll);
  router.post(
    '/accept-invitation',
    validateBody(acceptInvitationRequestSchema),
    controller.acceptInvitation,
  );
  router.get('/me', authenticate, controller.me);

  return router;
}
