import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

/** Parses+replaces req.body with the schema's output; a failure becomes a
 * ZodError, which the central error handler maps to a 400 with field
 * details. */
export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(result.error);
      return;
    }
    req.body = result.data;
    next();
  };
}

/** Same as validateBody, for query strings — list endpoints (pagination,
 * search, filtering, sorting) validate req.query this way rather than each
 * service re-parsing/defaulting raw string params by hand. Express's
 * req.query is technically read-only in types but assignable at runtime;
 * `as never` documents that this is the one sanctioned place doing it. */
export function validateQuery(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(result.error);
      return;
    }
    req.query = result.data as never;
    next();
  };
}
