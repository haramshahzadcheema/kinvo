import {
  dismissYellowZoneRequestSchema,
  resolveYellowZoneRequestSchema,
  yellowZoneListQuerySchema,
} from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { authorize } from '../../core/middleware/authorize';
import { validateBody, validateQuery } from '../../core/middleware/validate';
import { createYellowZoneController } from './yellow-zone.controller';
import type { YellowZoneService } from './yellow-zone.service';

// A flat top-level resource, same shape as /api/v1/assignments — the
// escalation queue is inherently cross-ship (a dispatcher's whole
// organization-wide "what needs attention" view), not owned by one ship
// the way TruckRequirement is owned by Ship. `yellow-zone:*` are their own
// RBAC actions, not folded into ships:read/ships:manage — see
// core/rbac/permissions.ts's comment on why.
export function createYellowZoneRouter(
  yellowZoneService: YellowZoneService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const controller = createYellowZoneController(yellowZoneService);

  router.use(authenticate);

  router.get(
    '/',
    authorize('yellow-zone:read'),
    validateQuery(yellowZoneListQuerySchema),
    controller.listYellowZoneItems,
  );
  router.get('/stats', authorize('yellow-zone:read'), controller.getYellowZoneStatusCounts);
  router.get('/:itemId', authorize('yellow-zone:read'), controller.getYellowZoneItem);

  router.patch('/:itemId/claim', authorize('yellow-zone:manage'), controller.claimYellowZoneItem);
  router.patch(
    '/:itemId/resolve',
    authorize('yellow-zone:manage'),
    validateBody(resolveYellowZoneRequestSchema),
    controller.resolveYellowZoneItem,
  );
  router.patch(
    '/:itemId/dismiss',
    authorize('yellow-zone:manage'),
    validateBody(dismissYellowZoneRequestSchema),
    controller.dismissYellowZoneItem,
  );

  return router;
}
