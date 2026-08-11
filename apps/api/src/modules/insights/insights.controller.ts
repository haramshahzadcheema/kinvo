import type { InsightsSummaryQuery } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import type { InsightsService } from './insights.service';

export interface InsightsController {
  getSummary: RequestHandler;
}

export function createInsightsController(insightsService: InsightsService): InsightsController {
  const getSummary: RequestHandler = async (req, res, next) => {
    try {
      const result = await insightsService.getSummary(req.query as unknown as InsightsSummaryQuery);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  return { getSummary };
}
