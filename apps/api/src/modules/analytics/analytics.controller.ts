import type { AnalyticsSummaryQuery } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import type { AnalyticsService } from './analytics.service';

export interface AnalyticsController {
  getSummary: RequestHandler;
}

export function createAnalyticsController(analyticsService: AnalyticsService): AnalyticsController {
  const getSummary: RequestHandler = async (req, res, next) => {
    try {
      const result = await analyticsService.getSummary(req.query as unknown as AnalyticsSummaryQuery);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  return { getSummary };
}
