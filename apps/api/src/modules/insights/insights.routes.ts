import { insightsSummaryQuerySchema } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { authorize } from '../../core/middleware/authorize';
import { validateQuery } from '../../core/middleware/validate';
import { createInsightsController } from './insights.controller';
import type { InsightsService } from './insights.service';

// A flat top-level, read-only resource — same shape as
// /api/v1/analytics and /api/v1/timeline.
export function createInsightsRouter(
  insightsService: InsightsService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const controller = createInsightsController(insightsService);

  router.use(authenticate);
  router.get(
    '/summary',
    authorize('insights:read'),
    validateQuery(insightsSummaryQuerySchema),
    controller.getSummary,
  );

  return router;
}
