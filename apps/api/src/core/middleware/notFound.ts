import type { RequestHandler } from 'express';
import { NotFoundError } from '../errors/AppError';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
};
