import type { LivenessResponse } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import { getReadiness } from './health.service';

export const getLiveness: RequestHandler = (_req, res) => {
  const body: LivenessResponse = { status: 'ok', timestamp: new Date().toISOString() };
  res.status(200).json(body);
};

export const getReadinessHandler: RequestHandler = async (_req, res, next) => {
  try {
    const readiness = await getReadiness();
    res.status(readiness.status === 'ok' ? 200 : 503).json(readiness);
  } catch (error) {
    next(error);
  }
};
