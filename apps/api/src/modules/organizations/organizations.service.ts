import type { CreateInvitationRequest, InvitationDto, Member, RoleValue } from '@kinvo/contracts';
import type { Invitation } from '@prisma/client';
import type { AuditLogger } from '../../core/audit/audit-logger';
import { ConflictError, NotFoundError } from '../../core/errors/AppError';
import type { prisma as prismaClient } from '../../core/prisma';
import { getRequestContext } from '../../core/request-context';

const INVITATION_TTL_DAYS = 7;

// Prisma Client Extensions change the shape of the transaction-callback
// client just enough that the base `Prisma.TransactionClient` type doesn't
// structurally match it — deriving the type from the actual extended
// client (rather than importing the generic one) is what keeps this
// correct instead of fighting the type checker with a cast.
type TransactionClient = Parameters<Parameters<typeof prismaClient.$transaction>[0]>[0];

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
  // Takes a row-level lock on every active-owner membership in this
  // organization before counting them, for the life of the enclosing
  // transaction. Fixes a real, confirmed-under-load race: the previous
  // version's count() and the eventual update() were separate, unlocked
  // statements, so two concurrent requests demoting/removing two DIFFERENT
  // owners of the same org could each read "2 owners, safe" before either
  // committed — reproduced live 5 times in a row, each leaving the
  // organization with zero active owners. `FOR UPDATE` isn't reachable
  // through Prisma's query builder, so this is raw SQL, manually scoped by
  // organizationId in the query itself (the tenant-scoping extension only
  // intercepts model operations, not $queryRaw — see core/prisma.ts).
  async function assertNotLastOwnerLocked(
    tx: TransactionClient,
    organizationId: string,
    membershipId: string,
    currentRole: RoleValue,
  ): Promise<void> {
    if (currentRole !== 'OWNER') {
      return;
    }
    const owners = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM memberships
      WHERE "organizationId" = ${organizationId} AND role = 'OWNER' AND status = 'ACTIVE'
      FOR UPDATE
    `;
    if (owners.length <= 1) {
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

    const { previousRole, updated } = await prisma.$transaction(async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: membershipId, status: 'ACTIVE' },
      });
      if (!target) {
        throw new NotFoundError('Membership not found.');
      }

      if (target.role !== role) {
        await assertNotLastOwnerLocked(tx, context.organizationId, membershipId, target.role);
      }

      const updated = await tx.membership.update({
        where: { id: membershipId },
        data: { role },
        include: { user: true },
      });

      return { previousRole: target.role, updated };
    });

    auditLogger.record({
      type: 'membership.role_changed',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: membershipId,
      metadata: { previousRole, newRole: role },
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

    await prisma.$transaction(async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: membershipId, status: 'ACTIVE' },
      });
      if (!target) {
        throw new NotFoundError('Membership not found.');
      }

      await assertNotLastOwnerLocked(tx, context.organizationId, membershipId, target.role);

      await tx.membership.update({ where: { id: membershipId }, data: { status: 'REMOVED' } });
    });

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
