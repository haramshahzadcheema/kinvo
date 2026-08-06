import type { CreateDriverRequest, DriverListQuery, UpdateDriverRequest } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import type { DriversService } from './drivers.service';

export interface DriversController {
  listDrivers: RequestHandler;
  getDriver: RequestHandler;
  createDriver: RequestHandler;
  updateDriver: RequestHandler;
  deleteDriver: RequestHandler;
}

export function createDriversController(driversService: DriversService): DriversController {
  const listDrivers: RequestHandler = async (req, res, next) => {
    try {
      const result = await driversService.listDrivers(req.query as unknown as DriverListQuery);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const getDriver: RequestHandler = async (req, res, next) => {
    try {
      const driver = await driversService.getDriver(req.params.driverId as string);
      res.status(200).json(driver);
    } catch (error) {
      next(error);
    }
  };

  const createDriver: RequestHandler = async (req, res, next) => {
    try {
      const driver = await driversService.createDriver(req.body as CreateDriverRequest);
      res.status(201).json(driver);
    } catch (error) {
      next(error);
    }
  };

  const updateDriver: RequestHandler = async (req, res, next) => {
    try {
      const driver = await driversService.updateDriver(
        req.params.driverId as string,
        req.body as UpdateDriverRequest,
      );
      res.status(200).json(driver);
    } catch (error) {
      next(error);
    }
  };

  const deleteDriver: RequestHandler = async (req, res, next) => {
    try {
      await driversService.deleteDriver(req.params.driverId as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  return { listDrivers, getDriver, createDriver, updateDriver, deleteDriver };
}
