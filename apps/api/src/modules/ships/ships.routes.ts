import {
  createShipRequestSchema,
  documentRequirementInputSchema,
  shipListQuerySchema,
  truckRequirementInputSchema,
  updateDocumentRequirementRequestSchema,
  updateShipRequestSchema,
  updateShipStatusRequestSchema,
  updateTruckRequirementRequestSchema,
} from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { authorize } from '../../core/middleware/authorize';
import { validateBody, validateQuery } from '../../core/middleware/validate';
import { createShipsController } from './ships.controller';
import type { ShipsService } from './ships.service';

export function createShipsRouter(shipsService: ShipsService, authenticate: RequestHandler): Router {
  const router = Router();
  const controller = createShipsController(shipsService);

  router.use(authenticate);

  router.get(
    '/',
    authorize('ships:read'),
    validateQuery(shipListQuerySchema),
    controller.listShips,
  );
  router.post(
    '/',
    authorize('ships:manage'),
    validateBody(createShipRequestSchema),
    controller.createShip,
  );
  router.get('/:shipId', authorize('ships:read'), controller.getShip);
  router.patch(
    '/:shipId',
    authorize('ships:manage'),
    validateBody(updateShipRequestSchema),
    controller.updateShip,
  );
  router.patch(
    '/:shipId/status',
    authorize('ships:manage'),
    validateBody(updateShipStatusRequestSchema),
    controller.updateShipStatus,
  );
  router.delete('/:shipId', authorize('ships:manage'), controller.deleteShip);

  router.post(
    '/:shipId/truck-requirements',
    authorize('ships:manage'),
    validateBody(truckRequirementInputSchema),
    controller.addTruckRequirement,
  );
  router.patch(
    '/:shipId/truck-requirements/:truckRequirementId',
    authorize('ships:manage'),
    validateBody(updateTruckRequirementRequestSchema),
    controller.updateTruckRequirement,
  );
  router.delete(
    '/:shipId/truck-requirements/:truckRequirementId',
    authorize('ships:manage'),
    controller.removeTruckRequirement,
  );

  router.post(
    '/:shipId/document-requirements',
    authorize('ships:manage'),
    validateBody(documentRequirementInputSchema),
    controller.addDocumentRequirement,
  );
  router.patch(
    '/:shipId/document-requirements/:documentRequirementId',
    authorize('ships:manage'),
    validateBody(updateDocumentRequirementRequestSchema),
    controller.updateDocumentRequirement,
  );
  router.delete(
    '/:shipId/document-requirements/:documentRequirementId',
    authorize('ships:manage'),
    controller.removeDocumentRequirement,
  );

  return router;
}
