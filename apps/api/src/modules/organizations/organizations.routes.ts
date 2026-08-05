import { createInvitationRequestSchema, updateMemberRoleRequestSchema } from '@kinvo/contracts';
import { Router } from 'express';
import { authenticate } from '../../core/middleware/authenticate';
import { authorize } from '../../core/middleware/authorize';
import { validateBody } from '../../core/middleware/validate';
import { createOrganizationsController } from './organizations.controller';
import type { OrganizationsService } from './organizations.service';

export function createOrganizationsRouter(organizationsService: OrganizationsService): Router {
  const router = Router();
  const controller = createOrganizationsController(organizationsService);

  router.use(authenticate);

  router.get('/members', authorize('members:read'), controller.listMembers);
  router.patch(
    '/members/:membershipId',
    authorize('members:manage'),
    validateBody(updateMemberRoleRequestSchema),
    controller.updateMemberRole,
  );
  router.delete('/members/:membershipId', authorize('members:manage'), controller.removeMember);

  router.get('/invitations', authorize('invitations:read'), controller.listInvitations);
  router.post(
    '/invitations',
    authorize('invitations:create'),
    validateBody(createInvitationRequestSchema),
    controller.createInvitation,
  );
  router.delete(
    '/invitations/:invitationId',
    authorize('invitations:revoke'),
    controller.revokeInvitation,
  );

  return router;
}
