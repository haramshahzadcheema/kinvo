import type { CreateInvitationRequest, UpdateMemberRoleRequest } from '@kinvo/contracts';
import type { RequestHandler } from 'express';
import type { OrganizationsService } from './organizations.service';

export interface OrganizationsController {
  listMembers: RequestHandler;
  updateMemberRole: RequestHandler;
  removeMember: RequestHandler;
  createInvitation: RequestHandler;
  listInvitations: RequestHandler;
  revokeInvitation: RequestHandler;
}

export function createOrganizationsController(
  organizationsService: OrganizationsService,
): OrganizationsController {
  const listMembers: RequestHandler = async (_req, res, next) => {
    try {
      const members = await organizationsService.listMembers();
      res.status(200).json({ members });
    } catch (error) {
      next(error);
    }
  };

  const updateMemberRole: RequestHandler = async (req, res, next) => {
    try {
      const { role } = req.body as UpdateMemberRoleRequest;
      const member = await organizationsService.updateMemberRole(
        req.params.membershipId as string,
        role,
      );
      res.status(200).json(member);
    } catch (error) {
      next(error);
    }
  };

  const removeMember: RequestHandler = async (req, res, next) => {
    try {
      await organizationsService.removeMember(req.params.membershipId as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  const createInvitation: RequestHandler = async (req, res, next) => {
    try {
      const invitation = await organizationsService.createInvitation(
        req.body as CreateInvitationRequest,
      );
      res.status(201).json(invitation);
    } catch (error) {
      next(error);
    }
  };

  const listInvitations: RequestHandler = async (_req, res, next) => {
    try {
      const invitations = await organizationsService.listInvitations();
      res.status(200).json({ invitations });
    } catch (error) {
      next(error);
    }
  };

  const revokeInvitation: RequestHandler = async (req, res, next) => {
    try {
      await organizationsService.revokeInvitation(req.params.invitationId as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  return {
    listMembers,
    updateMemberRole,
    removeMember,
    createInvitation,
    listInvitations,
    revokeInvitation,
  };
}
