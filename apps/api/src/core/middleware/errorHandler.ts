import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';
import { logger } from '../logger';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

// Express identifies error middleware by arity (4 params) — `_next` must stay
// even though it's unused; the leading underscore satisfies the lint rule.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = typeof req.id === 'string' ? req.id : undefined;

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId }, err.message);
    }
    const body: ErrorResponseBody = {
      error: { code: err.code, message: err.message, requestId, details: err.details },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ErrorResponseBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        requestId,
        details: err.flatten(),
      },
    };
    res.status(400).json(body);
    return;
  }

  logger.error({ err, requestId }, 'Unhandled error');
  const body: ErrorResponseBody = {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
      requestId,
    },
  };
  res.status(500).json(body);
};
