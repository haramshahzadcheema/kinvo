import type {
  CreateShipRequest,
  DocumentRequirementInput,
  ShipListQuery,
  TruckRequirementInput,
  UpdateShipRequest,
  UpdateShipStatusRequest,
} from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import type { ShipsService } from './ships.service';

export interface ShipsController {
  listShips: RequestHandler;
  getShip: RequestHandler;
  createShip: RequestHandler;
  updateShip: RequestHandler;
  updateShipStatus: RequestHandler;
  deleteShip: RequestHandler;
  addTruckRequirement: RequestHandler;
  updateTruckRequirement: RequestHandler;
  removeTruckRequirement: RequestHandler;
  addDocumentRequirement: RequestHandler;
  updateDocumentRequirement: RequestHandler;
  removeDocumentRequirement: RequestHandler;
}

export function createShipsController(shipsService: ShipsService): ShipsController {
  const listShips: RequestHandler = async (req, res, next) => {
    try {
      const result = await shipsService.listShips(req.query as unknown as ShipListQuery);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const getShip: RequestHandler = async (req, res, next) => {
    try {
      const ship = await shipsService.getShip(req.params.shipId as string);
      res.status(200).json(ship);
    } catch (error) {
      next(error);
    }
  };

  const createShip: RequestHandler = async (req, res, next) => {
    try {
      const ship = await shipsService.createShip(req.body as CreateShipRequest);
      res.status(201).json(ship);
    } catch (error) {
      next(error);
    }
  };

  const updateShip: RequestHandler = async (req, res, next) => {
    try {
      const ship = await shipsService.updateShip(
        req.params.shipId as string,
        req.body as UpdateShipRequest,
      );
      res.status(200).json(ship);
    } catch (error) {
      next(error);
    }
  };

  const updateShipStatus: RequestHandler = async (req, res, next) => {
    try {
      const { status } = req.body as UpdateShipStatusRequest;
      const ship = await shipsService.updateShipStatus(req.params.shipId as string, status);
      res.status(200).json(ship);
    } catch (error) {
      next(error);
    }
  };

  const deleteShip: RequestHandler = async (req, res, next) => {
    try {
      await shipsService.deleteShip(req.params.shipId as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  const addTruckRequirement: RequestHandler = async (req, res, next) => {
    try {
      const requirement = await shipsService.addTruckRequirement(
        req.params.shipId as string,
        req.body as TruckRequirementInput,
      );
      res.status(201).json(requirement);
    } catch (error) {
      next(error);
    }
  };

  const updateTruckRequirement: RequestHandler = async (req, res, next) => {
    try {
      const requirement = await shipsService.updateTruckRequirement(
        req.params.shipId as string,
        req.params.truckRequirementId as string,
        req.body as Partial<TruckRequirementInput>,
      );
      res.status(200).json(requirement);
    } catch (error) {
      next(error);
    }
  };

  const removeTruckRequirement: RequestHandler = async (req, res, next) => {
    try {
      await shipsService.removeTruckRequirement(
        req.params.shipId as string,
        req.params.truckRequirementId as string,
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  const addDocumentRequirement: RequestHandler = async (req, res, next) => {
    try {
      const requirement = await shipsService.addDocumentRequirement(
        req.params.shipId as string,
        req.body as DocumentRequirementInput,
      );
      res.status(201).json(requirement);
    } catch (error) {
      next(error);
    }
  };

  const updateDocumentRequirement: RequestHandler = async (req, res, next) => {
    try {
      const requirement = await shipsService.updateDocumentRequirement(
        req.params.shipId as string,
        req.params.documentRequirementId as string,
        req.body as Partial<DocumentRequirementInput>,
      );
      res.status(200).json(requirement);
    } catch (error) {
      next(error);
    }
  };

  const removeDocumentRequirement: RequestHandler = async (req, res, next) => {
    try {
      await shipsService.removeDocumentRequirement(
        req.params.shipId as string,
        req.params.documentRequirementId as string,
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  return {
    listShips,
    getShip,
    createShip,
    updateShip,
    updateShipStatus,
    deleteShip,
    addTruckRequirement,
    updateTruckRequirement,
    removeTruckRequirement,
    addDocumentRequirement,
    updateDocumentRequirement,
    removeDocumentRequirement,
  };
}
