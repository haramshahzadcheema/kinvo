import type { CreateReminderCampaignRequest, ReminderCampaignListQuery } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import type { RemindersService } from './reminders.service';

export interface RemindersController {
  listReminderCampaigns: RequestHandler;
  getReminderCampaign: RequestHandler;
  createReminderCampaign: RequestHandler;
  approveReminderCampaign: RequestHandler;
  cancelReminderCampaign: RequestHandler;
}

export function createRemindersController(
  remindersService: RemindersService,
): RemindersController {
  const listReminderCampaigns: RequestHandler = async (req, res, next) => {
    try {
      const result = await remindersService.listReminderCampaigns(
        req.query as unknown as ReminderCampaignListQuery,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const getReminderCampaign: RequestHandler = async (req, res, next) => {
    try {
      const campaign = await remindersService.getReminderCampaign(req.params.campaignId as string);
      res.status(200).json(campaign);
    } catch (error) {
      next(error);
    }
  };

  const createReminderCampaign: RequestHandler = async (req, res, next) => {
    try {
      const campaign = await remindersService.createReminderCampaign(
        req.body as CreateReminderCampaignRequest,
      );
      res.status(201).json(campaign);
    } catch (error) {
      next(error);
    }
  };

  const approveReminderCampaign: RequestHandler = async (req, res, next) => {
    try {
      const campaign = await remindersService.approveReminderCampaign(
        req.params.campaignId as string,
      );
      res.status(200).json(campaign);
    } catch (error) {
      next(error);
    }
  };

  const cancelReminderCampaign: RequestHandler = async (req, res, next) => {
    try {
      const campaign = await remindersService.cancelReminderCampaign(
        req.params.campaignId as string,
      );
      res.status(200).json(campaign);
    } catch (error) {
      next(error);
    }
  };

  return {
    listReminderCampaigns,
    getReminderCampaign,
    createReminderCampaign,
    approveReminderCampaign,
    cancelReminderCampaign,
  };
}
