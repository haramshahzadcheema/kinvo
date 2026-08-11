import { analyticsSummaryQuerySchema } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { authorize } from '../../core/middleware/authorize';
import { validateQuery } from '../../core/middleware/validate';
import { createAnalyticsController } from './analytics.controller';
import type { AnalyticsService } from './analytics.service';

// A flat top-level, read-only resource — same shape as /api/v1/timeline.
export function createAnalyticsRouter(
  analyticsService: AnalyticsService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const controller = createAnalyticsController(analyticsService);

  router.use(authenticate);
  router.get(
    '/summary',
    authorize('analytics:read'),
    validateQuery(analyticsSummaryQuerySchema),
    controller.getSummary,
  );

  return router;
}
