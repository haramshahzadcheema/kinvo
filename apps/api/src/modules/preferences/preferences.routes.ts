import { updateSettingsRequestSchema } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { validateBody } from '../../core/middleware/validate';
import { createPreferencesController } from './preferences.controller';
import type { PreferencesService } from './preferences.service';

// Deliberately no `authorize()` calls, matching notification.routes.ts's
// exact reasoning — this protects a PERSONAL resource ("is this MY
// settings"), not a shared organizational one a role check would gate.
// `authenticate` alone is the correct and complete gate: any
// authenticated member, any role, can read and manage their own
// appearance/notification preferences.
export function createPreferencesRouter(
  preferencesService: PreferencesService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const controller = createPreferencesController(preferencesService);

  router.use(authenticate);

  router.get('/', controller.getSettings);
  router.patch('/', validateBody(updateSettingsRequestSchema), controller.updateSettings);

  return router;
}
