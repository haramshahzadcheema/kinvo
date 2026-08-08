import { notificationListQuerySchema } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { validateQuery } from '../../core/middleware/validate';
import { createNotificationController } from './notification.controller';
import type { NotificationService } from './notification.service';

// Deliberately no `authorize()` calls anywhere in this router — a
// notification inbox is authorized by OWNERSHIP (userId === the verified
// token's own userId, enforced inside notification.service.ts's WHERE
// clauses), not by role. Every existing RBAC-gated router in this codebase
// protects a shared organizational resource ("can this role manage
// ships"); this one protects a personal one ("is this MY notification"),
// which is a materially different authorization question — see
// docs/ARCHITECTURE.md's Phase 6 Decisions log. `authenticate` alone is
// the correct and complete gate: any authenticated member, any role, can
// read and manage their own inbox.
export function createNotificationRouter(
  notificationService: NotificationService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const controller = createNotificationController(notificationService);

  router.use(authenticate);

  router.get('/', validateQuery(notificationListQuerySchema), controller.listNotifications);
  router.get('/unread-count', controller.getUnreadCount);
  router.patch('/mark-all-read', controller.markAllRead);
  router.patch('/:notificationId/read', controller.markRead);

  return router;
}
