import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import type { Container } from './core/container';
import { createAuthenticateMiddleware } from './core/middleware/authenticate';
import { errorHandler } from './core/middleware/errorHandler';
import { notFoundHandler } from './core/middleware/notFound';
import { logger } from './core/logger';
import { createAssignmentsRouter } from './modules/assignments/assignments.routes';
import { createAuthRouter } from './modules/auth/auth.routes';
import { createDriversRouter } from './modules/drivers/drivers.routes';
import { createHealthRouter } from './modules/health/health.routes';
import { createOrganizationsRouter } from './modules/organizations/organizations.routes';
import { createShipsRouter } from './modules/ships/ships.routes';
import { createVoiceRouters } from './modules/voice/voice.routes';

export function createApp(container: Container): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      // Default genReqId returns a per-process incrementing number, which is
      // useless for correlating a request across multiple instances — a UUID
      // is what actually makes X-Request-Id/log correlation meaningful.
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = typeof existing === 'string' ? existing : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
    }),
  );

  const authenticate = createAuthenticateMiddleware(container.tokenRevocationStore);
  const voiceRouters = createVoiceRouters(container.voiceService, container.voiceProvider, authenticate);

  app.use('/health', createHealthRouter(container.healthService));
  // Public, unauthenticated — see voice.routes.ts for why. Mounted before
  // the authenticated API routes so it's obviously not behind any of them.
  // The router itself defines the `/call-e` path, so this mounts at
  // `/webhooks`, not `/webhooks/call-e` (which would double up the segment).
  app.use('/webhooks', voiceRouters.webhookRouter);
  app.use('/api/v1/auth', createAuthRouter(container.authService, authenticate));
  app.use(
    '/api/v1/organizations',
    createOrganizationsRouter(container.organizationsService, authenticate),
  );
  app.use('/api/v1/ships', createShipsRouter(container.shipsService, authenticate));
  app.use('/api/v1/drivers', createDriversRouter(container.driversService, authenticate));
  app.use(
    '/api/v1/assignments',
    createAssignmentsRouter(container.assignmentsService, authenticate),
  );
  // Mounted at the same base path as assignments, as a second router — see
  // voice.routes.ts for why this stays a separate module instead of a
  // change to assignments.routes.ts itself.
  app.use('/api/v1/assignments', voiceRouters.actionsRouter);
  app.use('/api/v1/voice-calls', voiceRouters.callsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
