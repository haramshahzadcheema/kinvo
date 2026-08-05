import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import type { Container } from './core/container';
import { errorHandler } from './core/middleware/errorHandler';
import { notFoundHandler } from './core/middleware/notFound';
import { logger } from './core/logger';
import { createAuthRouter } from './modules/auth/auth.routes';
import { createHealthRouter } from './modules/health/health.routes';
import { createOrganizationsRouter } from './modules/organizations/organizations.routes';

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

  app.use('/health', createHealthRouter(container.healthService));
  app.use('/api/v1/auth', createAuthRouter(container.authService));
  app.use('/api/v1/organizations', createOrganizationsRouter(container.organizationsService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
