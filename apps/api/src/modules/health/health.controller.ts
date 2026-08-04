import type { LivenessResponse } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import type { HealthService } from './health.service';

export interface HealthController {
  getLiveness: RequestHandler;
  getReadinessHandler: RequestHandler;
}

export function createHealthController(healthService: HealthService): HealthController {
  const getLiveness: RequestHandler = (_req, res) => {
    const body: LivenessResponse = { status: 'ok', timestamp: new Date().toISOString() };
    res.status(200).json(body);
  };

  const getReadinessHandler: RequestHandler = async (_req, res, next) => {
    try {
      const readiness = await healthService.getReadiness();
      res.status(readiness.status === 'ok' ? 200 : 503).json(readiness);
    } catch (error) {
      next(error);
    }
  };

  return { getLiveness, getReadinessHandler };
}
