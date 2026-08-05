import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createHealthController } from './health.controller';
import type { HealthService } from './health.service';

export function createHealthRouter(healthService: HealthService): Router {
  const router = Router();
  const controller = createHealthController(healthService);

  // Health endpoints are unauthenticated by nature (that's what makes them
  // useful to orchestrators/monitors), which also makes them the cheapest
  // possible target for driving load into Postgres/Redis. This is a fixed,
  // generous ceiling — the web dashboard polls /health/ready once per 15s,
  // so 20 requests per 10s per IP has wide headroom for legitimate use
  // while still bounding worst-case abuse. Created fresh per router
  // instance, not at module scope — see auth.routes.ts for why that
  // distinction matters (it silently broke test isolation there).
  const healthRateLimiter = rateLimit({
    windowMs: 10_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  });
  router.use(healthRateLimiter);

  // Liveness: is the process up at all? No dependency checks — used by
  // container orchestrators to decide whether to restart the process.
  router.get('/live', controller.getLiveness);

  // Readiness: can this instance actually serve traffic? Checks the
  // dependencies every request handler in the app implicitly relies on.
  router.get('/ready', controller.getReadinessHandler);

  return router;
}
