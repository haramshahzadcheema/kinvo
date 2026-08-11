import { timelineListQuerySchema } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { authorize } from '../../core/middleware/authorize';
import { validateQuery } from '../../core/middleware/validate';
import { createTimelineController } from './timeline.controller';
import type { TimelineService } from './timeline.service';

// A flat top-level, read-only resource — same shape as /api/v1/yellow-zone
// and /api/v1/reminder-campaigns, not nested under /ships/:shipId, since
// the feed is deliberately org-wide (see timeline.service.ts).
export function createTimelineRouter(
  timelineService: TimelineService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const controller = createTimelineController(timelineService);

  router.use(authenticate);
  router.get('/', authorize('timeline:read'), validateQuery(timelineListQuerySchema), controller.listTimeline);

  return router;
}
