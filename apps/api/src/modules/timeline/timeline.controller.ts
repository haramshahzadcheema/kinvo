import type { TimelineListQuery } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import type { TimelineService } from './timeline.service';

export interface TimelineController {
  listTimeline: RequestHandler;
}

export function createTimelineController(timelineService: TimelineService): TimelineController {
  const listTimeline: RequestHandler = async (req, res, next) => {
    try {
      const result = await timelineService.listTimeline(req.query as unknown as TimelineListQuery);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  return { listTimeline };
}
