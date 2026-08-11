import type {
  AcceptInvitationRequest,
  AuthResponse,
  LoginRequest,
  MeResponse,
  RegisterOrganizationRequest,
  UpdateMeRequest,
} from '@kinvo/contracts';
import { Prisma, type Membership, type Organization, type User } from '@prisma/client';
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
  updateMe(context: RequestContext, input: UpdateMeRequest): Promise<MeResponse>;
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

    let created: { user: User; organization: Organization; membership: Membership };
    try {
      created = await withoutTenantScope(
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
    } catch (error) {
      // Same class of bug as acceptInvitation below: the up-front
      // existingUser check is a courtesy, not a guarantee, and
      // generateUniqueSlug's check-then-create loop has the same gap for
      // slug — confirmed under concurrency: 7 of 8 simultaneous
      // registrations with the same email raised uncaught P2002 (unique
      // constraint) errors that surfaced as raw 500s instead of a clean
      // conflict response.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : '';
        if (target.includes('email')) {
          throw new ConflictError('An account with this email already exists.');
        }
        if (target.includes('slug')) {
          throw new ConflictError(
            'This organization name is temporarily unavailable — please try again.',
          );
        }
        throw new ConflictError('This request conflicts with existing data.');
      }
      throw error;
    }
    const { user, organization, membership } = created;

    await auditLogger.record({
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

    await auditLogger.record({
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

    if (existingToken.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token is expired or revoked.');
    }

    // Atomically claim the token: this update only matches (and only one
    // concurrent request can win it) if revokedAt is still null. Two
    // simultaneous refresh calls presenting the same token used to both
    // pass a plain read-then-check here, both proceed to mint a new token,
    // and both "win" — confirmed empirically under concurrency (3 successes
    // out of 15 concurrent requests against the live stack, with two
    // simultaneously-unrevoked tokens left in the database). The
    // WHERE-guarded updateMany serializes on Postgres's row lock: the
    // loser's WHERE no longer matches once the winner's revokedAt commits,
    // so claim.count is 0 for every request except the first.
    const claim = await prisma.refreshToken.updateMany({
      where: { id: existingToken.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (claim.count === 0) {
      // Lost the race against a concurrent refresh, or this token was
      // already revoked by a prior rotation/reuse event. Either way,
      // presenting a non-active token is a reuse/theft signal: revoke the
      // entire family, forcing re-login on every device sharing it.
      await prisma.refreshToken.updateMany({
        where: { familyId: existingToken.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedError(
        'Refresh token reuse detected; all sessions for this login have been revoked.',
      );
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

    // revokedAt was already set atomically by the claim step above — only
    // replacedByTokenId needs setting now that the new token's id exists.
    await prisma.refreshToken.update({
      where: { id: existingToken.id },
      data: { replacedByTokenId: newToken.id },
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
    await auditLogger.record({
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
    await auditLogger.record({
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

    let created: { user: User; organization: Organization; membership: Membership };
    try {
      created = await withoutTenantScope(
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
    } catch (error) {
      // The up-front existingUser check above is a courtesy, not a
      // guarantee — two concurrent accept-invitation requests for the same
      // invitation both pass it before either commits. Confirmed under
      // concurrency: the losing request's tx.user.create hits User.email's
      // unique constraint and Prisma throws P2002, which — uncaught —
      // surfaced as a raw 500 instead of the same clean conflict response
      // the up-front check already gives a non-concurrent duplicate.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(
          'An account with this email already exists. Joining a second organization is not yet supported.',
        );
      }
      throw error;
    }
    const { user, organization, membership } = created;

    await auditLogger.record({
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

  // Name-only — email has no verification flow in this codebase (see
  // AccountSection.tsx's own comment), so it deliberately stays out of
  // this request shape entirely rather than becoming a free, unverified
  // edit. User is not tenant-scoped (it's the platform identity, not an
  // org-owned row), so this is a direct findUniqueOrThrow/update by id,
  // same as getMe's own user lookup above.
  async function updateMe(context: RequestContext, input: UpdateMeRequest): Promise<MeResponse> {
    const [user, organization, membership] = await Promise.all([
      prisma.user.update({
        where: { id: context.userId },
        data: { firstName: input.firstName, lastName: input.lastName },
      }),
      prisma.organization.findUniqueOrThrow({ where: { id: context.organizationId } }),
      prisma.membership.findUniqueOrThrow({ where: { id: context.membershipId } }),
    ]);

    await auditLogger.record({
      type: 'user.updated',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: context.userId,
    });

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
    updateMe,
  };
}
