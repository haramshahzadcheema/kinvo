import { Prisma } from '@prisma/client';
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

// body-parser (behind express.json()) throws plain Error objects with a
// pre-computed HTTP status for well-understood client mistakes — a body
// over the size limit (413), syntactically invalid JSON (400) — that were
// previously discarded and replaced with a generic 500 by the catch-all
// below. Confirmed via chaos testing: both a >100kb request body and
// malformed JSON syntax returned 500 instead of the status body-parser had
// already computed. This checks structurally rather than importing
// body-parser's error type directly, since any well-behaved upstream
// middleware (not just this one) may throw the same shape.
function upstreamClientErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  const status = 'status' in err ? err.status : 'statusCode' in err ? err.statusCode : undefined;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
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

  // Prisma throws this when it cannot reach Postgres at all (connection
  // refused/timeout) — confirmed via chaos testing: killing the Postgres
  // container made every DB-dependent route fall through to the generic
  // 500 branch below. 500 implies our code is broken; 503 correctly tells
  // the client (and any retry/backoff logic) that this is a transient
  // downstream outage, not an application bug.
  if (err instanceof Prisma.PrismaClientInitializationError) {
    logger.error({ err, requestId }, 'Database connection unavailable');
    const body: ErrorResponseBody = {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is temporarily unavailable. Please try again shortly.',
        requestId,
      },
    };
    res.status(503).json(body);
    return;
  }

  // Postgres's deadlock detector picked this transaction as the victim and
  // aborted it (SQLSTATE 40P01), which Prisma surfaces as P2034 — this is
  // expected, occasional behavior under concurrent writes, not a bug: the
  // other transaction in the cycle proceeds and commits normally. The
  // correct client behavior is a transparent retry, so this is modeled as
  // a 409 (matching every other "your write lost a race, try again" case
  // in this app — see ConflictError) rather than falling through to the
  // generic 500 below, which would incorrectly read as an application bug
  // instead of a transient, self-resolving conflict.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
    logger.warn({ err, requestId }, 'Transaction aborted by deadlock detection; safe to retry');
    const body: ErrorResponseBody = {
      error: {
        code: 'CONCURRENT_UPDATE',
        message: 'This update conflicted with another in-progress change. Please try again.',
        requestId,
      },
    };
    res.status(409).json(body);
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

  const upstreamStatus = upstreamClientErrorStatus(err);
  if (upstreamStatus !== undefined) {
    logger.warn({ err, requestId }, 'Client error from upstream middleware');
    const body: ErrorResponseBody = {
      error: {
        code: 'BAD_REQUEST',
        message: 'The request could not be processed.',
        requestId,
      },
    };
    res.status(upstreamStatus).json(body);
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
