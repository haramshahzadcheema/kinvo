import type { UpdateSettingsRequest } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import type { PreferencesService } from './preferences.service';

export interface PreferencesController {
  getSettings: RequestHandler;
  updateSettings: RequestHandler;
}

export function createPreferencesController(
  preferencesService: PreferencesService,
): PreferencesController {
  const getSettings: RequestHandler = async (_req, res, next) => {
    try {
      const result = await preferencesService.getSettings();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const updateSettings: RequestHandler = async (req, res, next) => {
    try {
      const result = await preferencesService.updateSettings(req.body as UpdateSettingsRequest);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  return { getSettings, updateSettings };
}
