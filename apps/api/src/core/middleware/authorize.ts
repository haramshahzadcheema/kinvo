import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors/AppError';
import { hasPermission, type Action } from '../rbac/permissions';

/** Must run after `authenticate` — depends on `req.context` being populated. */
export function authorize(action: Action): RequestHandler {
  return (req, _res, next) => {
    if (!req.context) {
      next(new UnauthorizedError('Missing request context.'));
      return;
    }

    if (!hasPermission(req.context.role, action)) {
      next(new ForbiddenError(`Role ${req.context.role} is not permitted to perform "${action}".`));
      return;
    }

    next();
  };
}
