import type { CreateInvitationRequest, InvitationDto, Member, RoleValue } from '@kinvo/contracts';
import type { Invitation } from '@prisma/client';
import type { AuditLogger } from '../../core/audit/audit-logger';
import { ConflictError, NotFoundError } from '../../core/errors/AppError';
import type { prisma as prismaClient } from '../../core/prisma';
import { getRequestContext } from '../../core/request-context';

const INVITATION_TTL_DAYS = 7;

export interface OrganizationsServiceDependencies {
  prisma: typeof prismaClient;
  generateInvitationTokenValue: () => string;
  hashInvitationTokenValue: (rawValue: string) => string;
  auditLogger: AuditLogger;
}

export interface OrganizationsService {
  listMembers(): Promise<Member[]>;
  updateMemberRole(membershipId: string, role: RoleValue): Promise<Member>;
  removeMember(membershipId: string): Promise<void>;
  createInvitation(input: CreateInvitationRequest): Promise<InvitationDto>;
  listInvitations(): Promise<InvitationDto[]>;
  revokeInvitation(invitationId: string): Promise<void>;
}

function toInvitationDto(invitation: Invitation, inviteToken?: string): InvitationDto {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    inviteToken,
  };
}

export function createOrganizationsService({
  prisma,
  generateInvitationTokenValue,
  hashInvitationTokenValue,
  auditLogger,
}: OrganizationsServiceDependencies): OrganizationsService {
  async function findActiveMembership(membershipId: string) {
    return prisma.membership.findFirst({ where: { id: membershipId, status: 'ACTIVE' } });
  }

  async function assertNotLastOwner(membershipId: string, currentRole: RoleValue): Promise<void> {
    if (currentRole !== 'OWNER') {
      return;
    }
    const ownerCount = await prisma.membership.count({
      where: { role: 'OWNER', status: 'ACTIVE' },
    });
    if (ownerCount <= 1) {
      throw new ConflictError("Cannot remove or demote the organization's last remaining owner.", {
        membershipId,
      });
    }
  }

  async function listMembers(): Promise<Member[]> {
    const memberships = await prisma.membership.findMany({
      where: { status: 'ACTIVE' },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      membershipId: membership.id,
      userId: membership.userId,
      email: membership.user.email,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      role: membership.role,
      status: membership.status,
      createdAt: membership.createdAt.toISOString(),
    }));
  }

  async function updateMemberRole(membershipId: string, role: RoleValue): Promise<Member> {
    const context = getRequestContext();

    const target = await findActiveMembership(membershipId);
    if (!target) {
      throw new NotFoundError('Membership not found.');
    }

    if (target.role !== role) {
      await assertNotLastOwner(membershipId, target.role);
    }

    const updated = await prisma.membership.update({
      where: { id: membershipId },
      data: { role },
      include: { user: true },
    });

    auditLogger.record({
      type: 'membership.role_changed',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: membershipId,
      metadata: { previousRole: target.role, newRole: role },
    });

    return {
      membershipId: updated.id,
      userId: updated.userId,
      email: updated.user.email,
      firstName: updated.user.firstName,
      lastName: updated.user.lastName,
      role: updated.role,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async function removeMember(membershipId: string): Promise<void> {
    const context = getRequestContext();

    const target = await findActiveMembership(membershipId);
    if (!target) {
      throw new NotFoundError('Membership not found.');
    }

    await assertNotLastOwner(membershipId, target.role);

    await prisma.membership.update({ where: { id: membershipId }, data: { status: 'REMOVED' } });

    auditLogger.record({
      type: 'membership.removed',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: membershipId,
    });
  }

  async function createInvitation(input: CreateInvitationRequest): Promise<InvitationDto> {
    const context = getRequestContext();

    const existingMember = await prisma.membership.findFirst({
      where: { status: 'ACTIVE', user: { email: input.email } },
    });
    if (existingMember) {
      throw new ConflictError('This email already belongs to a member of the organization.');
    }

    const existingInvitation = await prisma.invitation.findFirst({
      where: { email: input.email, status: 'PENDING' },
    });
    if (existingInvitation) {
      throw new ConflictError('An invitation is already pending for this email.');
    }

    const rawToken = generateInvitationTokenValue();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);

    const invitation = await prisma.invitation.create({
      data: {
        // Explicit, not relied-on-implicitly: the tenant-scoping extension
        // would auto-inject this too, but Prisma's generated types can't
        // see that (it's a runtime-only guarantee) — so writes stay
        // statically type-safe by supplying it directly. The extension's
        // auto-injection on `where` (reads/updates/deletes) is the half of
        // the guarantee that matters most, since a forgotten scope there
        // silently returns wrong-tenant data instead of failing loudly the
        // way a missing NOT NULL column would on a create.
        organizationId: context.organizationId,
        email: input.email,
        role: input.role,
        tokenHash: hashInvitationTokenValue(rawToken),
        invitedById: context.userId,
        expiresAt,
      },
    });

    auditLogger.record({
      type: 'invitation.sent',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: invitation.id,
      metadata: { email: input.email, role: input.role },
    });

    // The invite link/token is returned exactly once, here — Phase 1 has
    // no email delivery, so the caller (an OWNER/ADMIN) is responsible for
    // sharing it manually. It is never included in list responses.
    return toInvitationDto(invitation, rawToken);
  }

  async function listInvitations(): Promise<InvitationDto[]> {
    const invitations = await prisma.invitation.findMany({ orderBy: { createdAt: 'desc' } });
    return invitations.map((invitation) => toInvitationDto(invitation));
  }

  async function revokeInvitation(invitationId: string): Promise<void> {
    const context = getRequestContext();

    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, status: 'PENDING' },
    });
    if (!invitation) {
      throw new NotFoundError('Invitation not found or already resolved.');
    }

    await prisma.invitation.update({ where: { id: invitationId }, data: { status: 'REVOKED' } });

    auditLogger.record({
      type: 'invitation.revoked',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: invitationId,
    });
  }

  return {
    listMembers,
    updateMemberRole,
    removeMember,
    createInvitation,
    listInvitations,
    revokeInvitation,
  };
}
