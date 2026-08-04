import { Router } from 'express';
import { getLiveness, getReadinessHandler } from './health.controller';

export const healthRouter = Router();

// Liveness: is the process up at all? No dependency checks — used by
// container orchestrators to decide whether to restart the process.
healthRouter.get('/live', getLiveness);

// Readiness: can this instance actually serve traffic? Checks the
// dependencies every request handler in the app implicitly relies on.
healthRouter.get('/ready', getReadinessHandler);
