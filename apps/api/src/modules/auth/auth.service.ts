import type {
  AcceptInvitationRequest,
  AuthResponse,
  LoginRequest,
  MeResponse,
  RegisterOrganizationRequest,
} from '@kinvo/contracts';
import type { Membership, Organization, User } from '@prisma/client';
import type { AuditLogger } from '../../core/audit/audit-logger';
import { ConflictError, UnauthorizedError } from '../../core/errors/AppError';
import type { prisma as prismaClient } from '../../core/prisma';
import { withoutTenantScope } from '../../core/prisma';
import type { RequestContext } from '../../core/request-context';

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

/** `AuthResponse` plus the raw refresh token — the controller puts the
 * token in an httpOnly cookie and strips it before the JSON body goes out;
 * it must never appear in a response payload. */
export interface AuthResult extends AuthResponse {
  refreshToken: string;
}

export interface AuthServiceDependencies {
  prisma: typeof prismaClient;
  hashPassword: (plainTextPassword: string) => Promise<string>;
  verifyPassword: (hashedPassword: string, plainTextPassword: string) => Promise<boolean>;
  signAccessToken: (payload: {
    sub: string;
    organizationId: string;
    membershipId: string;
    role: Membership['role'];
  }) => string;
  generateRefreshTokenValue: () => string;
  hashRefreshTokenValue: (rawValue: string) => string;
  refreshTokenExpiryDate: () => Date;
  hashInvitationTokenValue: (rawValue: string) => string;
  generateFamilyId: () => string;
  auditLogger: AuditLogger;
}

export interface AuthService {
  registerOrganization(input: RegisterOrganizationRequest, meta: RequestMeta): Promise<AuthResult>;
  login(input: LoginRequest, meta: RequestMeta): Promise<AuthResult>;
  refresh(rawRefreshToken: string, meta: RequestMeta): Promise<AuthResult>;
  logout(rawRefreshToken: string): Promise<void>;
  logoutAll(rawRefreshToken: string): Promise<void>;
  acceptInvitation(input: AcceptInvitationRequest, meta: RequestMeta): Promise<AuthResult>;
  getMe(context: RequestContext): Promise<MeResponse>;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'organization'
  );
}

function toAuthDtos(
  user: User,
  organization: Organization,
  membership: Membership,
): Pick<AuthResponse, 'user' | 'organization' | 'membership'> {
  return {
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    membership: { id: membership.id, role: membership.role },
  };
}

export function createAuthService({
  prisma,
  hashPassword,
  verifyPassword,
  signAccessToken,
  generateRefreshTokenValue,
  hashRefreshTokenValue,
  refreshTokenExpiryDate,
  hashInvitationTokenValue,
  generateFamilyId,
  auditLogger,
}: AuthServiceDependencies): AuthService {
  async function generateUniqueSlug(organizationName: string): Promise<string> {
    const base = slugify(organizationName);
    let candidate = base;
    let suffix = 0;

    // Organization isn't a tenant-scoped model (it IS the tenant) — this
    // query runs through the extension untouched, no bypass needed. Each
    // candidate depends on the previous check, so this loop is
    // sequential by necessity.
    while (await prisma.organization.findUnique({ where: { slug: candidate } })) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }

    return candidate;
  }

  async function resolveActiveMembership(userId: string): Promise<Membership | null> {
    return withoutTenantScope(
      "Resolving a user's organization membership before any tenant context can exist for this request (login/refresh run pre-authentication).",
      (client) => client.membership.findFirst({ where: { userId, status: 'ACTIVE' } }),
    );
  }

  async function issueTokens(
    user: User,
    organization: Organization,
    membership: Membership,
    meta: RequestMeta,
    familyId: string = generateFamilyId(),
  ): Promise<AuthResult> {
    const rawRefreshToken = generateRefreshTokenValue();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshTokenValue(rawRefreshToken),
        familyId,
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt: refreshTokenExpiryDate(),
      },
    });

    const accessToken = signAccessToken({
      sub: user.id,
      organizationId: organization.id,
      membershipId: membership.id,
      role: membership.role,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      ...toAuthDtos(user, organization, membership),
    };
  }

  async function registerOrganization(
    input: RegisterOrganizationRequest,
    meta: RequestMeta,
  ): Promise<AuthResult> {
    const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
    if (existingUser) {
      throw new ConflictError('An account with this email already exists.');
    }

    const [passwordHash, slug] = await Promise.all([
      hashPassword(input.password),
      generateUniqueSlug(input.organizationName),
    ]);

    const { user, organization, membership } = await withoutTenantScope(
      'Creating a brand-new organization + owner user + first membership during registration — no tenant context exists yet because the organization is being created in this same call.',
      (client) =>
        client.$transaction(async (tx) => {
          const organization = await tx.organization.create({
            data: { name: input.organizationName, slug },
          });
          const user = await tx.user.create({
            data: {
              email: input.email,
              passwordHash,
              firstName: input.firstName,
              lastName: input.lastName,
            },
          });
          const membership = await tx.membership.create({
            data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
          });
          return { user, organization, membership };
        }),
    );

    auditLogger.record({
      type: 'auth.register_organization',
      actorUserId: user.id,
      organizationId: organization.id,
    });

    return issueTokens(user, organization, membership, meta);
  }

  async function login(input: LoginRequest, meta: RequestMeta): Promise<AuthResult> {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Invalid email or password.');
    }

    const passwordValid = await verifyPassword(user.passwordHash, input.password);
    if (!passwordValid) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    const membership = await resolveActiveMembership(user.id);
    if (!membership) {
      throw new UnauthorizedError('This account has no active organization membership.');
    }

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: membership.organizationId },
    });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    auditLogger.record({
      type: 'auth.login',
      actorUserId: user.id,
      organizationId: organization.id,
    });

    return issueTokens(user, organization, membership, meta);
  }

  async function refresh(rawRefreshToken: string, meta: RequestMeta): Promise<AuthResult> {
    const tokenHash = hashRefreshTokenValue(rawRefreshToken);
    const existingToken = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existingToken) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    if (existingToken.replacedByTokenId) {
      // Reuse of an already-rotated token: theft/replay signal. Revoke
      // every token in the family, forcing re-login on every device
      // sharing it.
      await prisma.refreshToken.updateMany({
        where: { familyId: existingToken.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedError(
        'Refresh token reuse detected; all sessions for this login have been revoked.',
      );
    }

    if (existingToken.revokedAt !== null || existingToken.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token is expired or revoked.');
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: existingToken.userId } });
    const membership = await resolveActiveMembership(user.id);
    if (!membership) {
      throw new UnauthorizedError('This account has no active organization membership.');
    }
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: membership.organizationId },
    });

    const rawNewRefreshToken = generateRefreshTokenValue();
    const newTokenHash = hashRefreshTokenValue(rawNewRefreshToken);

    const newToken = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newTokenHash,
        familyId: existingToken.familyId,
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt: refreshTokenExpiryDate(),
      },
    });

    await prisma.refreshToken.update({
      where: { id: existingToken.id },
      data: { revokedAt: new Date(), replacedByTokenId: newToken.id },
    });

    const accessToken = signAccessToken({
      sub: user.id,
      organizationId: organization.id,
      membershipId: membership.id,
      role: membership.role,
    });

    return {
      accessToken,
      refreshToken: rawNewRefreshToken,
      ...toAuthDtos(user, organization, membership),
    };
  }

  async function logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashRefreshTokenValue(rawRefreshToken);
    const token = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!token) {
      return; // Already gone/invalid — logout is idempotent, not an error.
    }

    await prisma.refreshToken.updateMany({
      where: { familyId: token.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const membership = await resolveActiveMembership(token.userId);
    auditLogger.record({
      type: 'auth.logout',
      actorUserId: token.userId,
      organizationId: membership?.organizationId,
    });
  }

  async function logoutAll(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashRefreshTokenValue(rawRefreshToken);
    const token = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!token) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    await prisma.refreshToken.updateMany({
      where: { userId: token.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const membership = await resolveActiveMembership(token.userId);
    auditLogger.record({
      type: 'auth.logout_all',
      actorUserId: token.userId,
      organizationId: membership?.organizationId,
    });
  }

  async function acceptInvitation(
    input: AcceptInvitationRequest,
    meta: RequestMeta,
  ): Promise<AuthResult> {
    const tokenHash = hashInvitationTokenValue(input.token);

    const invitation = await withoutTenantScope(
      'Resolving an invitation by its token before any tenant context exists — the invitation itself is how we learn which organization this request is for.',
      (client) => client.invitation.findUnique({ where: { tokenHash } }),
    );

    if (!invitation || invitation.status !== 'PENDING' || invitation.expiresAt < new Date()) {
      throw new UnauthorizedError('This invitation is invalid or has expired.');
    }

    const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });
    if (existingUser) {
      // Phase 1 scope: exactly one active membership per user, by design
      // (see docs/ARCHITECTURE.md). Accepting a second organization's
      // invitation for an existing account isn't supported yet — this is
      // an honest rejection, not a half-built multi-membership path.
      throw new ConflictError(
        'An account with this email already exists. Joining a second organization is not yet supported.',
      );
    }

    const passwordHash = await hashPassword(input.password);

    const { user, organization, membership } = await withoutTenantScope(
      'Creating the invited user + their first membership + marking the invitation accepted, in one transaction — no tenant context exists yet for this brand-new membership.',
      (client) =>
        client.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: invitation.email,
              passwordHash,
              firstName: input.firstName,
              lastName: input.lastName,
            },
          });
          const membership = await tx.membership.create({
            data: {
              userId: user.id,
              organizationId: invitation.organizationId,
              role: invitation.role,
            },
          });
          await tx.invitation.update({
            where: { id: invitation.id },
            data: { status: 'ACCEPTED', acceptedAt: new Date() },
          });
          const organization = await tx.organization.findUniqueOrThrow({
            where: { id: invitation.organizationId },
          });
          return { user, organization, membership };
        }),
    );

    auditLogger.record({
      type: 'invitation.accepted',
      actorUserId: user.id,
      organizationId: organization.id,
      targetId: invitation.id,
    });

    return issueTokens(user, organization, membership, meta);
  }

  async function getMe(context: RequestContext): Promise<MeResponse> {
    const [user, organization, membership] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: context.userId } }),
      prisma.organization.findUniqueOrThrow({ where: { id: context.organizationId } }),
      // Membership IS tenant-scoped, so this call runs inside the bound
      // request context set up by `authenticate` — the extension merges in
      // organizationId automatically, which doubles as a consistency check
      // that this membership genuinely belongs to the token's organization.
      prisma.membership.findUniqueOrThrow({ where: { id: context.membershipId } }),
    ]);

    return toAuthDtos(user, organization, membership);
  }

  return {
    registerOrganization,
    login,
    refresh,
    logout,
    logoutAll,
    acceptInvitation,
    getMe,
  };
}
