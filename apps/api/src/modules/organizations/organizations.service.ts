import type {
  CreateInvitationRequest,
  InvitationDto,
  Member,
  RoleValue,
  UpdateOrganizationRequest,
  UpdateOrganizationResponse,
} from '@kinvo/contracts';
import type { Invitation } from '@prisma/client';
import type { AuditLogger } from '../../core/audit/audit-logger';
import { ConflictError, NotFoundError } from '../../core/errors/AppError';
import type { prisma as prismaClient, TransactionClient } from '../../core/prisma';
import { getRequestContext } from '../../core/request-context';
import type { TokenRevocationStore } from '../../core/security/token-revocation';

const INVITATION_TTL_DAYS = 7;

export interface OrganizationsServiceDependencies {
  prisma: typeof prismaClient;
  generateInvitationTokenValue: () => string;
  hashInvitationTokenValue: (rawValue: string) => string;
  auditLogger: AuditLogger;
  tokenRevocationStore: TokenRevocationStore;
}

export interface OrganizationsService {
  listMembers(): Promise<Member[]>;
  updateMemberRole(membershipId: string, role: RoleValue): Promise<Member>;
  removeMember(membershipId: string): Promise<void>;
  createInvitation(input: CreateInvitationRequest): Promise<InvitationDto>;
  listInvitations(): Promise<InvitationDto[]>;
  revokeInvitation(invitationId: string): Promise<void>;
  updateOrganization(input: UpdateOrganizationRequest): Promise<UpdateOrganizationResponse>;
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
  tokenRevocationStore,
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

    // Any access token already issued for this membership still carries the
    // old role for up to JWT_ACCESS_TTL unless explicitly revoked — see
    // core/security/token-revocation.ts. Only called when the role
    // genuinely changed, matching assertNotLastOwnerLocked's guard above:
    // a no-op "change" to the same role has nothing stale to invalidate,
    // and would otherwise force a redundant token refresh on every device
    // this member is signed in on.
    if (previousRole !== role) {
      await tokenRevocationStore.revokeMembership(membershipId);
    }

    await auditLogger.record({
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

    // Unconditional, unlike the role-change guard above — removal always
    // represents a genuine access change, and refresh() (auth.service.ts)
    // will correctly reject this membership's refresh token on its next
    // use once status is REMOVED, but the still-live access token needs
    // this to stop working before its own exp.
    await tokenRevocationStore.revokeMembership(membershipId);

    await auditLogger.record({
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

    await auditLogger.record({
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

    await auditLogger.record({
      type: 'invitation.revoked',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: invitationId,
    });
  }

  // Name-only — slug is assigned once at registration (generateUniqueSlug
  // in auth.service.ts) and never re-derived here, since anything
  // already linking to this org by slug (an accepted invitation's own
  // history, a bookmarked URL if one existed) shouldn't silently start
  // pointing somewhere else because of a later rename. Organization
  // isn't tenant-scoped by the Prisma extension (it IS the tenant), so
  // the `where` is explicit rather than relying on auto-injection —
  // same reasoning as generateUniqueSlug's own lookup.
  async function updateOrganization(
    input: UpdateOrganizationRequest,
  ): Promise<UpdateOrganizationResponse> {
    const context = getRequestContext();

    const updated = await prisma.organization.update({
      where: { id: context.organizationId },
      data: { name: input.name },
    });

    await auditLogger.record({
      type: 'organization.updated',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: context.organizationId,
    });

    return { id: updated.id, name: updated.name, slug: updated.slug };
  }

  return {
    listMembers,
    updateMemberRole,
    removeMember,
    createInvitation,
    listInvitations,
    revokeInvitation,
    updateOrganization,
  };
}
