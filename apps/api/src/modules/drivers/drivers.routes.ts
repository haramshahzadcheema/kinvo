import {
  createDriverRequestSchema,
  driverListQuerySchema,
  updateDriverRequestSchema,
} from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { authorize } from '../../core/middleware/authorize';
import { validateBody, validateQuery } from '../../core/middleware/validate';
import { createDriversController } from './drivers.controller';
import type { DriversService } from './drivers.service';

export function createDriversRouter(
  driversService: DriversService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const controller = createDriversController(driversService);

  router.use(authenticate);

  router.get(
    '/',
    authorize('drivers:read'),
    validateQuery(driverListQuerySchema),
    controller.listDrivers,
  );
  router.post(
    '/',
    authorize('drivers:manage'),
    validateBody(createDriverRequestSchema),
    controller.createDriver,
  );
  router.get('/:driverId', authorize('drivers:read'), controller.getDriver);
  router.patch(
    '/:driverId',
    authorize('drivers:manage'),
    validateBody(updateDriverRequestSchema),
    controller.updateDriver,
  );
  router.delete('/:driverId', authorize('drivers:manage'), controller.deleteDriver);

  return router;
}
