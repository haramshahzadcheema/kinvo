import type {
  DismissYellowZoneRequest,
  ResolveYellowZoneRequest,
  YellowZoneItemDto,
  YellowZoneListQuery,
  YellowZoneListResponse,
  YellowZoneStatusCounts,
} from '@kinvo/contracts';
import { YELLOW_ZONE_DISMISSED, YELLOW_ZONE_RESOLVED, YELLOW_ZONE_UPDATED } from '@kinvo/contracts';
import { Prisma } from '@prisma/client';
import type { AuditLogger } from '../../core/audit/audit-logger';
import { ConflictError, NotFoundError } from '../../core/errors/AppError';
import type { prisma as prismaClient, TransactionClient } from '../../core/prisma';
import type { EmitToOrganization } from '../../core/realtime/emitter';
import { getRequestContext } from '../../core/request-context';
import { classifyEscalation } from '../../core/yellow-zone/escalationClassification';

export interface YellowZoneServiceDependencies {
  prisma: typeof prismaClient;
  auditLogger: AuditLogger;
  emitToOrganization: EmitToOrganization;
}

export interface CreateEscalationInput {
  organizationId: string;
  assignmentAttemptId: string;
  reason: string | null;
  /** The voice provider that produced the unresolved call — used only to
   * attribute the audit entry, matching assignments.service.ts's
   * `system:${provider}` actorUserId convention for system-initiated
   * writes (see its `auditActorId` helper). */
  provider: string;
}

export interface YellowZoneService {
  listYellowZoneItems(query: YellowZoneListQuery): Promise<YellowZoneListResponse>;
  getYellowZoneStatusCounts(): Promise<YellowZoneStatusCounts>;
  getYellowZoneItem(id: string): Promise<YellowZoneItemDto>;
  claimYellowZoneItem(id: string): Promise<YellowZoneItemDto>;
  resolveYellowZoneItem(id: string, input: ResolveYellowZoneRequest): Promise<YellowZoneItemDto>;
  dismissYellowZoneItem(id: string, input: DismissYellowZoneRequest): Promise<YellowZoneItemDto>;
  /**
   * Internal, worker-facing entry point — called only from
   * voice.service.ts, inside the SAME transaction as the SYSTEM_ERROR
   * AssignmentAttempt it escalates. Never exposed over HTTP. Takes a
   * transaction client, not the module-level `prisma`, precisely so the
   * caller controls atomicity — see that call site for why a crash
   * between "attempt recorded" and "escalation created" must not be a
   * reachable state.
   */
  createEscalationForAttempt(
    tx: TransactionClient,
    input: CreateEscalationInput,
  ): Promise<YellowZoneItemDto | null>;
}

const YELLOW_ZONE_CONTEXT_INCLUDE = {
  assignmentAttempt: {
    select: {
      assignmentId: true,
      assignment: {
        select: {
          driver: { select: { fullName: true, phone: true } },
          truckRequirement: {
            select: {
              destination: true,
              truckType: true,
              ship: { select: { shipName: true } },
            },
          },
        },
      },
    },
  },
  assignedToUser: { select: { firstName: true, lastName: true } },
} satisfies Prisma.YellowZoneItemInclude;

type YellowZoneItemWithContext = Prisma.YellowZoneItemGetPayload<{
  include: typeof YELLOW_ZONE_CONTEXT_INCLUDE;
}>;

function toYellowZoneItemDto(item: YellowZoneItemWithContext): YellowZoneItemDto {
  const { assignment } = item.assignmentAttempt;
  return {
    id: item.id,
    assignmentId: item.assignmentAttempt.assignmentId,
    assignmentAttemptId: item.assignmentAttemptId,
    driverId: item.driverId,
    driverName: assignment.driver.fullName,
    driverPhone: assignment.driver.phone,
    shipId: item.shipId,
    shipName: assignment.truckRequirement.ship.shipName,
    destination: assignment.truckRequirement.destination,
    truckType: assignment.truckRequirement.truckType,
    reason: item.reason,
    priority: item.priority,
    status: item.status,
    assignedToUserId: item.assignedToUserId,
    assignedToUserName: item.assignedToUser
      ? `${item.assignedToUser.firstName} ${item.assignedToUser.lastName}`
      : null,
    resolutionNotes: item.resolutionNotes,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
  };
}

export function createYellowZoneService({
  prisma,
  auditLogger,
  emitToOrganization,
}: YellowZoneServiceDependencies): YellowZoneService {
  // Tenant-scoped via the Prisma extension (YellowZoneItem is in
  // TENANT_SCOPED_MODELS) — `findFirst({ where: { id } })` alone is
  // already org-safe, exactly like ships.service.ts's resolveOwnedShip.
  async function resolveOwnedYellowZoneItem(id: string): Promise<YellowZoneItemWithContext> {
    const item = await prisma.yellowZoneItem.findFirst({
      where: { id },
      include: YELLOW_ZONE_CONTEXT_INCLUDE,
    });
    if (!item) {
      throw new NotFoundError('Yellow Zone item not found.');
    }
    return item;
  }

  async function listYellowZoneItems(query: YellowZoneListQuery): Promise<YellowZoneListResponse> {
    const where: Prisma.YellowZoneItemWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.yellowZoneItem.findMany({
        where,
        include: YELLOW_ZONE_CONTEXT_INCLUDE,
        // Newest-first for PENDING/IN_REVIEW (what needs attention right
        // now), which is what the default (unfiltered-by-status) view
        // shows — a dispatcher's queue, not an archive.
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.yellowZoneItem.count({ where }),
    ]);

    return {
      items: items.map(toYellowZoneItemDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async function getYellowZoneStatusCounts(): Promise<YellowZoneStatusCounts> {
    const grouped = await prisma.yellowZoneItem.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts: YellowZoneStatusCounts = { PENDING: 0, IN_REVIEW: 0, RESOLVED: 0, DISMISSED: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }
    return counts;
  }

  async function getYellowZoneItem(id: string): Promise<YellowZoneItemDto> {
    return toYellowZoneItemDto(await resolveOwnedYellowZoneItem(id));
  }

  async function claimYellowZoneItem(id: string): Promise<YellowZoneItemDto> {
    const context = getRequestContext();
    await resolveOwnedYellowZoneItem(id); // 404s before the conflict-vs-not-found distinction matters

    // Same conditional-update-plus-affected-row-count pattern already
    // proven for assignment confirm/reject (assignments.service.ts) — two
    // dispatchers claiming the same item simultaneously: the first
    // `UPDATE ... WHERE status = 'PENDING'` wins, the second matches zero
    // rows and gets a clean 409, never a silent second claimant.
    const updated = await prisma.yellowZoneItem.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'IN_REVIEW', assignedToUserId: context.userId },
    });
    if (updated.count === 0) {
      throw new ConflictError('This item has already been claimed or is no longer pending.');
    }

    await auditLogger.record({
      type: 'yellow_zone.claimed',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: id,
    });

    const item = await resolveOwnedYellowZoneItem(id);
    emitToOrganization(context.organizationId, YELLOW_ZONE_UPDATED, {
      item: toYellowZoneItemDto(item),
    });
    return toYellowZoneItemDto(item);
  }

  async function resolveYellowZoneItem(
    id: string,
    input: ResolveYellowZoneRequest,
  ): Promise<YellowZoneItemDto> {
    const context = getRequestContext();
    await resolveOwnedYellowZoneItem(id);

    // Must be claimed first (IN_REVIEW) — resolving directly from PENDING
    // would record a resolution with no accountable owner, which defeats
    // "who owns it" (one of the explicit UX requirements for this queue).
    const updated = await prisma.yellowZoneItem.updateMany({
      where: { id, status: 'IN_REVIEW' },
      data: { status: 'RESOLVED', resolutionNotes: input.resolutionNotes, resolvedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ConflictError('This item must be claimed before it can be resolved.');
    }

    await auditLogger.record({
      type: 'yellow_zone.resolved',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: id,
    });

    const item = await resolveOwnedYellowZoneItem(id);
    emitToOrganization(context.organizationId, YELLOW_ZONE_RESOLVED, {
      item: toYellowZoneItemDto(item),
    });
    return toYellowZoneItemDto(item);
  }

  async function dismissYellowZoneItem(
    id: string,
    input: DismissYellowZoneRequest,
  ): Promise<YellowZoneItemDto> {
    const context = getRequestContext();
    await resolveOwnedYellowZoneItem(id);

    // Dismiss is reachable from either PENDING (a quick "not a real
    // issue, skip it" without claiming first) or IN_REVIEW (a dispatcher
    // who already claimed it and determined no action is needed) — never
    // from an already-terminal RESOLVED/DISMISSED state.
    const updated = await prisma.yellowZoneItem.updateMany({
      where: { id, status: { in: ['PENDING', 'IN_REVIEW'] } },
      data: {
        status: 'DISMISSED',
        resolutionNotes: input.resolutionNotes ?? null,
        resolvedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      throw new ConflictError('This item has already been resolved or dismissed.');
    }

    await auditLogger.record({
      type: 'yellow_zone.dismissed',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: id,
    });

    const item = await resolveOwnedYellowZoneItem(id);
    emitToOrganization(context.organizationId, YELLOW_ZONE_DISMISSED, {
      item: toYellowZoneItemDto(item),
    });
    return toYellowZoneItemDto(item);
  }

  async function createEscalationForAttempt(
    tx: TransactionClient,
    input: CreateEscalationInput,
  ): Promise<YellowZoneItemDto | null> {
    // The attempt this escalation is 1:1 against must exist within the
    // same transaction (it was just created by the caller) — walked here,
    // not passed in pre-fetched, so this function is the single place
    // that resolves the driver/ship denormalized context, matching
    // VOICE_CALL_ASSIGNMENT_CONTEXT's exact reasoning in voice.service.ts.
    const attempt = await tx.assignmentAttempt.findUniqueOrThrow({
      where: { id: input.assignmentAttemptId },
      select: {
        assignment: {
          select: {
            driverId: true,
            truckRequirement: { select: { shipId: true } },
          },
        },
      },
    });

    try {
      const created = await tx.yellowZoneItem.create({
        data: {
          organizationId: input.organizationId,
          assignmentAttemptId: input.assignmentAttemptId,
          driverId: attempt.assignment.driverId,
          shipId: attempt.assignment.truckRequirement.shipId,
          reason: input.reason ?? 'CALL-E could not resolve this call.',
          priority: classifyEscalation(input.reason),
        },
        include: YELLOW_ZONE_CONTEXT_INCLUDE,
      });

      // Logged inside the same transaction (the `tx` overload — see
      // audit-logger.ts) as the escalation it describes, not after commit:
      // this write has no human actor to attribute it to after the fact,
      // so unlike confirmAssignment/rejectAssignment's post-commit audit
      // calls, there's no separate request context to fall back on if this
      // failed independently.
      await auditLogger.record(
        {
          type: 'yellow_zone.escalated',
          actorUserId: `system:${input.provider}`,
          organizationId: input.organizationId,
          targetId: created.id,
        },
        tx,
      );

      return toYellowZoneItemDto(created);
    } catch (error) {
      // assignmentAttemptId's unique constraint is what makes a duplicate
      // webhook/reconciliation delivery for the same already-escalated
      // attempt a safe no-op — the AssignmentAttempt itself is only ever
      // created once per terminal event (Phase 4's existing idempotency),
      // so this can only fire on a genuine replay, never a legitimate
      // second escalation.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes('assignmentAttemptId')
      ) {
        return null;
      }
      throw error;
    }
  }

  return {
    listYellowZoneItems,
    getYellowZoneStatusCounts,
    getYellowZoneItem,
    claimYellowZoneItem,
    resolveYellowZoneItem,
    dismissYellowZoneItem,
    createEscalationForAttempt,
  };
}
