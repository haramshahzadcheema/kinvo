import type { RequestHandler } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authorize } from '../../core/middleware/authorize';
import type { VoiceProvider } from '../../core/voice/VoiceProvider';
import { createVoiceController } from './voice.controller';
import type { VoiceService } from './voice.service';

export interface VoiceRouters {
  actionsRouter: Router;
  webhookRouter: Router;
}

/**
 * Two separate routers sharing one controller, mounted at two very
 * different trust levels in app.ts:
 *
 *  - `actionsRouter` (`/api/v1/assignments/:assignmentId/voice-calls`) is a
 *    dispatcher-triggered action on the existing Assignment resource,
 *    behind `authenticate` + RBAC — reuses `ships:manage`, the same
 *    permission every other assignment-mutating action already requires
 *    (see core/rbac/permissions.ts). Kept in its own module/router rather
 *    than folded into assignments.routes.ts so Phase 3's already-hardened
 *    assignments module stays untouched — this is a new capability, not a
 *    modification to its existing surface.
 *  - `webhookRouter` (`/webhooks/call-e`) is CALL-E calling Kinvo, not the
 *    other way around — deliberately outside `authenticate` entirely (see
 *    voice.controller.ts's receiveCallEWebhook for why).
 */
export function createVoiceRouters(
  voiceService: VoiceService,
  voiceProvider: VoiceProvider,
  authenticate: RequestHandler,
): VoiceRouters {
  const controller = createVoiceController(voiceService, voiceProvider);

  const actionsRouter = Router();
  actionsRouter.post(
    '/:assignmentId/voice-calls',
    authenticate,
    authorize('ships:manage'),
    controller.placeCallForAssignment,
  );

  const webhookRouter = Router();
  // Public and unauthenticated by necessity (see above), which makes it the
  // one voice endpoint reachable by anyone on the internet, not just
  // CALL-E — same category of exposure as the auth router's public
  // endpoints, which already carry their own limiter (see
  // auth.routes.ts). Created fresh per createVoiceRouters() call, not at
  // module scope, for the same reason documented there: a module-scoped
  // limiter would be shared and silently break test isolation across every
  // buildApp() call. Generous relative to auth's (a real CALL-E account
  // under real load can legitimately fire many terminal events per minute)
  // but still bounded — an unrecognized-or-forged flood only ever costs a
  // cheap parse + a single indexed lookup per request (see
  // voice.service.ts's processWebhookSignal), so this exists to cap raw
  // request volume, not to protect an expensive code path.
  const webhookRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  webhookRouter.post('/call-e', webhookRateLimiter, controller.receiveCallEWebhook);

  return { actionsRouter, webhookRouter };
}
