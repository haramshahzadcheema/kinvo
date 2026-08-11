import { createReminderCampaignRequestSchema, reminderCampaignListQuerySchema } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { authorize } from '../../core/middleware/authorize';
import { validateBody, validateQuery } from '../../core/middleware/validate';
import { createRemindersController } from './reminders.controller';
import type { RemindersService } from './reminders.service';

// A flat top-level resource, same shape as /api/v1/yellow-zone — a
// dispatcher's reminder campaign list is cross-ship, not a nested
// sub-resource of one ship. `reminders:*` are their own RBAC actions, not
// folded into ships:read/ships:manage — see core/rbac/permissions.ts.
export function createRemindersRouter(
  remindersService: RemindersService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const controller = createRemindersController(remindersService);

  router.use(authenticate);

  router.get(
    '/',
    authorize('reminders:read'),
    validateQuery(reminderCampaignListQuerySchema),
    controller.listReminderCampaigns,
  );
  router.get('/:campaignId', authorize('reminders:read'), controller.getReminderCampaign);

  router.post(
    '/',
    authorize('reminders:manage'),
    validateBody(createReminderCampaignRequestSchema),
    controller.createReminderCampaign,
  );
  router.patch(
    '/:campaignId/approve',
    authorize('reminders:manage'),
    controller.approveReminderCampaign,
  );
  router.patch(
    '/:campaignId/cancel',
    authorize('reminders:manage'),
    controller.cancelReminderCampaign,
  );

  return router;
}
