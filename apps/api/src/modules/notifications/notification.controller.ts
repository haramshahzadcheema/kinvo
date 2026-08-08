import type { NotificationListQuery } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import type { NotificationService } from './notification.service';

export interface NotificationController {
  listNotifications: RequestHandler;
  getUnreadCount: RequestHandler;
  markRead: RequestHandler;
  markAllRead: RequestHandler;
}

export function createNotificationController(
  notificationService: NotificationService,
): NotificationController {
  const listNotifications: RequestHandler = async (req, res, next) => {
    try {
      const result = await notificationService.listNotifications(
        req.query as unknown as NotificationListQuery,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const getUnreadCount: RequestHandler = async (_req, res, next) => {
    try {
      const result = await notificationService.getUnreadCount();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const markRead: RequestHandler = async (req, res, next) => {
    try {
      const notification = await notificationService.markRead(req.params.notificationId as string);
      res.status(200).json(notification);
    } catch (error) {
      next(error);
    }
  };

  const markAllRead: RequestHandler = async (_req, res, next) => {
    try {
      const result = await notificationService.markAllRead();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  return { listNotifications, getUnreadCount, markRead, markAllRead };
}
