import type {
  AssignmentListQuery,
  CancelAssignmentRequest,
  CreateAssignmentRequest,
  LogAttemptRequest,
  RejectAssignmentRequest,
} from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import type { AssignmentsService } from './assignments.service';

export interface AssignmentsController {
  listAssignments: RequestHandler;
  getAssignment: RequestHandler;
  createAssignment: RequestHandler;
  confirmAssignment: RequestHandler;
  rejectAssignment: RequestHandler;
  withdrawAssignment: RequestHandler;
  cancelAssignment: RequestHandler;
  markNoShow: RequestHandler;
  logAttempt: RequestHandler;
}

export function createAssignmentsController(
  assignmentsService: AssignmentsService,
): AssignmentsController {
  const listAssignments: RequestHandler = async (req, res, next) => {
    try {
      const result = await assignmentsService.listAssignments(
        req.query as unknown as AssignmentListQuery,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const getAssignment: RequestHandler = async (req, res, next) => {
    try {
      const assignment = await assignmentsService.getAssignment(req.params.assignmentId as string);
      res.status(200).json(assignment);
    } catch (error) {
      next(error);
    }
  };

  const createAssignment: RequestHandler = async (req, res, next) => {
    try {
      const assignment = await assignmentsService.createAssignment(
        req.body as CreateAssignmentRequest,
      );
      res.status(201).json(assignment);
    } catch (error) {
      next(error);
    }
  };

  const confirmAssignment: RequestHandler = async (req, res, next) => {
    try {
      const assignment = await assignmentsService.confirmAssignment(
        req.params.assignmentId as string,
      );
      res.status(200).json(assignment);
    } catch (error) {
      next(error);
    }
  };

  const rejectAssignment: RequestHandler = async (req, res, next) => {
    try {
      const assignment = await assignmentsService.rejectAssignment(
        req.params.assignmentId as string,
        req.body as RejectAssignmentRequest,
      );
      res.status(200).json(assignment);
    } catch (error) {
      next(error);
    }
  };

  const withdrawAssignment: RequestHandler = async (req, res, next) => {
    try {
      const assignment = await assignmentsService.withdrawAssignment(
        req.params.assignmentId as string,
      );
      res.status(200).json(assignment);
    } catch (error) {
      next(error);
    }
  };

  const cancelAssignment: RequestHandler = async (req, res, next) => {
    try {
      const assignment = await assignmentsService.cancelAssignment(
        req.params.assignmentId as string,
        req.body as CancelAssignmentRequest,
      );
      res.status(200).json(assignment);
    } catch (error) {
      next(error);
    }
  };

  const markNoShow: RequestHandler = async (req, res, next) => {
    try {
      const assignment = await assignmentsService.markNoShow(req.params.assignmentId as string);
      res.status(200).json(assignment);
    } catch (error) {
      next(error);
    }
  };

  const logAttempt: RequestHandler = async (req, res, next) => {
    try {
      const attempt = await assignmentsService.logAttempt(
        req.params.assignmentId as string,
        req.body as LogAttemptRequest,
      );
      res.status(201).json(attempt);
    } catch (error) {
      next(error);
    }
  };

  return {
    listAssignments,
    getAssignment,
    createAssignment,
    confirmAssignment,
    rejectAssignment,
    withdrawAssignment,
    cancelAssignment,
    markNoShow,
    logAttempt,
  };
}
