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
