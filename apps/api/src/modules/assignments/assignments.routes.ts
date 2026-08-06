import {
  assignmentListQuerySchema,
  cancelAssignmentRequestSchema,
  createAssignmentRequestSchema,
  logAttemptRequestSchema,
  rejectAssignmentRequestSchema,
} from '@kinvo/contracts';
import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { authorize } from '../../core/middleware/authorize';
import { validateBody, validateQuery } from '../../core/middleware/validate';
import { createAssignmentsController } from './assignments.controller';
import type { AssignmentsService } from './assignments.service';

// A flat top-level resource, not nested under ships/truck-requirements —
// Assignment is a relationship between two independent aggregates
// (TruckRequirement and Driver), not a child owned by one the way
// TruckRequirement is owned by Ship. Nesting it under
// /ships/:shipId/truck-requirements/:id/assignments/:assignmentId would
// both introduce a deeper URL pattern than anything else in this codebase
// and still require a second top-level router anyway for the cross-ship
// "call list" (GET /assignments?status=PENDING) and per-driver history
// (GET /assignments?driverId=X) views — see docs/ARCHITECTURE.md's Phase
// 3 Decisions log for the full reasoning.
//
// No new RBAC actions: reuses ships:read/ships:manage, exactly like
// TruckRequirement/DocumentRequirement before it — see
// core/rbac/permissions.ts's comment on why sub-resources aren't
// separately permissioned.
export function createAssignmentsRouter(assignmentsService: AssignmentsService): Router {
  const router = Router();
  const controller = createAssignmentsController(assignmentsService);

  router.use(authenticate);

  router.get(
    '/',
    authorize('ships:read'),
    validateQuery(assignmentListQuerySchema),
    controller.listAssignments,
  );
  router.post(
    '/',
    authorize('ships:manage'),
    validateBody(createAssignmentRequestSchema),
    controller.createAssignment,
  );
  router.get('/:assignmentId', authorize('ships:read'), controller.getAssignment);

  router.patch('/:assignmentId/confirm', authorize('ships:manage'), controller.confirmAssignment);
  router.patch(
    '/:assignmentId/reject',
    authorize('ships:manage'),
    validateBody(rejectAssignmentRequestSchema),
    controller.rejectAssignment,
  );
  router.patch('/:assignmentId/withdraw', authorize('ships:manage'), controller.withdrawAssignment);
  router.patch(
    '/:assignmentId/cancel',
    authorize('ships:manage'),
    validateBody(cancelAssignmentRequestSchema),
    controller.cancelAssignment,
  );
  router.patch('/:assignmentId/no-show', authorize('ships:manage'), controller.markNoShow);

  router.post(
    '/:assignmentId/attempts',
    authorize('ships:manage'),
    validateBody(logAttemptRequestSchema),
    controller.logAttempt,
  );

  return router;
}
