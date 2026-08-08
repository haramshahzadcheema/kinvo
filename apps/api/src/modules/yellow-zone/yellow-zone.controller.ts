import type { DismissYellowZoneRequest, ResolveYellowZoneRequest, YellowZoneListQuery } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import type { YellowZoneService } from './yellow-zone.service';

export interface YellowZoneController {
  listYellowZoneItems: RequestHandler;
  getYellowZoneStatusCounts: RequestHandler;
  getYellowZoneItem: RequestHandler;
  claimYellowZoneItem: RequestHandler;
  unclaimYellowZoneItem: RequestHandler;
  resolveYellowZoneItem: RequestHandler;
  dismissYellowZoneItem: RequestHandler;
}

export function createYellowZoneController(
  yellowZoneService: YellowZoneService,
): YellowZoneController {
  const listYellowZoneItems: RequestHandler = async (req, res, next) => {
    try {
      const result = await yellowZoneService.listYellowZoneItems(
        req.query as unknown as YellowZoneListQuery,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const getYellowZoneStatusCounts: RequestHandler = async (_req, res, next) => {
    try {
      const counts = await yellowZoneService.getYellowZoneStatusCounts();
      res.status(200).json(counts);
    } catch (error) {
      next(error);
    }
  };

  const getYellowZoneItem: RequestHandler = async (req, res, next) => {
    try {
      const item = await yellowZoneService.getYellowZoneItem(req.params.itemId as string);
      res.status(200).json(item);
    } catch (error) {
      next(error);
    }
  };

  const claimYellowZoneItem: RequestHandler = async (req, res, next) => {
    try {
      const item = await yellowZoneService.claimYellowZoneItem(req.params.itemId as string);
      res.status(200).json(item);
    } catch (error) {
      next(error);
    }
  };

  const unclaimYellowZoneItem: RequestHandler = async (req, res, next) => {
    try {
      const item = await yellowZoneService.unclaimYellowZoneItem(req.params.itemId as string);
      res.status(200).json(item);
    } catch (error) {
      next(error);
    }
  };

  const resolveYellowZoneItem: RequestHandler = async (req, res, next) => {
    try {
      const item = await yellowZoneService.resolveYellowZoneItem(
        req.params.itemId as string,
        req.body as ResolveYellowZoneRequest,
      );
      res.status(200).json(item);
    } catch (error) {
      next(error);
    }
  };

  const dismissYellowZoneItem: RequestHandler = async (req, res, next) => {
    try {
      const item = await yellowZoneService.dismissYellowZoneItem(
        req.params.itemId as string,
        req.body as DismissYellowZoneRequest,
      );
      res.status(200).json(item);
    } catch (error) {
      next(error);
    }
  };

  return {
    listYellowZoneItems,
    getYellowZoneStatusCounts,
    getYellowZoneItem,
    claimYellowZoneItem,
    unclaimYellowZoneItem,
    resolveYellowZoneItem,
    dismissYellowZoneItem,
  };
}
