import type {
  AssignmentAttemptDto,
  AssignmentDto,
  AssignmentListQuery,
  AssignmentListResponse,
  AssignmentStatusValue,
  CancelAssignmentRequest,
  CreateAssignmentRequest,
  LogAttemptRequest,
  RejectAssignmentRequest,
} from '@kinvo/contracts';
import { Prisma } from '@prisma/client';
import { resolveTenantScopedTruckRequirement } from '../ships/ships.service';
import type { AuditLogger } from '../../core/audit/audit-logger';
import { ConflictError, NotFoundError } from '../../core/errors/AppError';
import type { prisma as prismaClient } from '../../core/prisma';
import { getRequestContext } from '../../core/request-context';

// Prisma Client Extensions change the shape of the transaction-callback
// client just enough that the base `Prisma.TransactionClient` type doesn't
// structurally match it — deriving the type from the actual extended
// client (rather than importing the generic one) is what keeps this
// correct instead of fighting the type checker with a cast. Same
// convention already established in organizations.service.ts.
type TransactionClient = Parameters<Parameters<typeof prismaClient.$transaction>[0]>[0];

export interface AssignmentsServiceDependencies {
  prisma: typeof prismaClient;
  auditLogger: AuditLogger;
}

export interface AssignmentsService {
  listAssignments(query: AssignmentListQuery): Promise<AssignmentListResponse>;
  getAssignment(assignmentId: string): Promise<AssignmentDto>;
  createAssignment(input: CreateAssignmentRequest): Promise<AssignmentDto>;
  confirmAssignment(assignmentId: string): Promise<AssignmentDto>;
  rejectAssignment(assignmentId: string, input: RejectAssignmentRequest): Promise<AssignmentDto>;
  withdrawAssignment(assignmentId: string): Promise<AssignmentDto>;
  cancelAssignment(assignmentId: string, input: CancelAssignmentRequest): Promise<AssignmentDto>;
  markNoShow(assignmentId: string): Promise<AssignmentDto>;
  logAttempt(assignmentId: string, input: LogAttemptRequest): Promise<AssignmentAttemptDto>;
}

// PENDING -> CONFIRMED | REJECTED | EXPIRED | WITHDRAWN (all terminal)
// CONFIRMED -> CANCELLED | NO_SHOW | COMPLETED (all terminal)
// EXPIRED and COMPLETED have no dispatcher-facing endpoint in Phase 3:
// EXPIRED is reserved for a future time-based system job (see
// docs/ARCHITECTURE.md's Phase 3 Decisions log — deliberately not
// auto-expiring yet, since silently closing an assignment a dispatcher is
// still working is exactly the kind of surprising system behavior this
// project avoids); COMPLETED is only reached via the ship-completion
// cascade in ships.service.ts, never directly.
const VALID_TRANSITIONS: Record<AssignmentStatusValue, readonly AssignmentStatusValue[]> = {
  PENDING: ['CONFIRMED', 'REJECTED', 'EXPIRED', 'WITHDRAWN'],
  CONFIRMED: ['CANCELLED', 'NO_SHOW', 'COMPLETED'],
  REJECTED: [],
  EXPIRED: [],
  WITHDRAWN: [],
  CANCELLED: [],
  NO_SHOW: [],
  COMPLETED: [],
};

function assertTransition(current: AssignmentStatusValue, next: AssignmentStatusValue): void {
  if (!VALID_TRANSITIONS[current].includes(next)) {
    throw new ConflictError(`Cannot move an assignment from ${current} to ${next}.`, {
      from: current,
      to: next,
    });
  }
}

// driverName/driverPhone/shipName/destination/truckType are denormalized
// onto the DTO from these three joined tables — see assignment.schema.ts
// for why (same reasoning as DriverDto.currentShipName since Phase 2).
const ASSIGNMENT_INCLUDE = {
  driver: { select: { fullName: true, phone: true } },
  truckRequirement: {
    select: {
      shipId: true,
      destination: true,
      truckType: true,
      rate: true,
      rateCurrency: true,
      ship: { select: { shipName: true } },
    },
  },
  attempts: { orderBy: { attemptedAt: 'desc' } },
} satisfies Prisma.AssignmentInclude;

type AssignmentWithRelations = Prisma.AssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

function toAssignmentAttemptDto(att: {
  id: string;
  outcome: AssignmentWithRelations['attempts'][number]['outcome'];
  notes: string | null;
  attemptedAt: Date;
}): AssignmentAttemptDto {
  return {
    id: att.id,
    outcome: att.outcome,
    notes: att.notes,
    attemptedAt: att.attemptedAt.toISOString(),
  };
}

function toAssignmentDto(a: AssignmentWithRelations): AssignmentDto {
  return {
    id: a.id,
    truckRequirementId: a.truckRequirementId,
    driverId: a.driverId,
    driverName: a.driver.fullName,
    driverPhone: a.driver.phone,
    shipId: a.truckRequirement.shipId,
    shipName: a.truckRequirement.ship.shipName,
    destination: a.truckRequirement.destination,
    truckType: a.truckRequirement.truckType,
    rate: a.truckRequirement.rate ? a.truckRequirement.rate.toNumber() : null,
    rateCurrency: a.truckRequirement.rateCurrency,
    status: a.status,
    agreedRate: a.agreedRate ? a.agreedRate.toNumber() : null,
    invitedAt: a.invitedAt.toISOString(),
    respondedAt: a.respondedAt?.toISOString() ?? null,
    cancelledAt: a.cancelledAt?.toISOString() ?? null,
    cancellationReason: a.cancellationReason,
    rejectionReason: a.rejectionReason,
    noShowAt: a.noShowAt?.toISOString() ?? null,
    completedAt: a.completedAt?.toISOString() ?? null,
    notes: a.notes,
    attempts: a.attempts.map(toAssignmentAttemptDto),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function createAssignmentsService({
  prisma,
  auditLogger,
}: AssignmentsServiceDependencies): AssignmentsService {
  // Assignment carries no organizationId (see schema.prisma's Assignment
  // model comment) — every query must explicitly filter through the
  // truckRequirement -> ship relation chain, since there is no tenant-
  // scoping Prisma extension to inject it automatically the way there is
  // for Ship/Driver. A cross-org assignment id simply fails to match this
  // filter and resolves to nothing — "invisible, not forbidden," the same
  // principle used everywhere else in this codebase.
  async function resolveOwnedAssignment(assignmentId: string): Promise<AssignmentWithRelations> {
    const context = getRequestContext();
    const assignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        truckRequirement: { ship: { organizationId: context.organizationId } },
      },
      include: ASSIGNMENT_INCLUDE,
    });
    if (!assignment) {
      throw new NotFoundError('Assignment not found.');
    }
    return assignment;
  }

  // If cancelling or no-showing a CONFIRMED assignment drops a ship that
  // had reached CONFIRMED status back below full coverage on any
  // requirement, the ship must not be left silently marked as if
  // everything were staffed — that's a worse surprise than a status
  // visibly reverting. See docs/ARCHITECTURE.md's Phase 3 Decisions log.
  //
  // Takes `tx`, not the outer `prisma`, and is only ever called from
  // inside cancelAssignment's/markNoShow's own $transaction — a crash
  // between "assignment cancelled, driver freed" and "ship reverted to
  // RECRUITING because it's now short" must not be possible; either the
  // whole sequence commits or none of it does.
  async function revertShipIfNowShort(
    tx: TransactionClient,
    shipId: string,
    actorUserId: string,
  ): Promise<void> {
    const ship = await tx.ship.findFirst({
      where: { id: shipId, status: 'CONFIRMED' },
      include: { truckRequirements: { include: { assignments: { select: { status: true } } } } },
    });
    if (!ship) return;

    const isShort = ship.truckRequirements.some((req) => {
      const confirmedCount = req.assignments.filter((a) => a.status === 'CONFIRMED').length;
      return confirmedCount < req.quantityNeeded;
    });
    if (!isShort) return;

    await tx.ship.update({ where: { id: shipId }, data: { status: 'RECRUITING' } });
    auditLogger.record({
      type: 'ship.status_changed',
      actorUserId,
      organizationId: ship.organizationId,
      targetId: shipId,
      metadata: {
        previousStatus: 'CONFIRMED',
        newStatus: 'RECRUITING',
        reason: 'shortage_after_assignment_change',
      },
    });
  }

  async function listAssignments(query: AssignmentListQuery): Promise<AssignmentListResponse> {
    const context = getRequestContext();
    const where: Prisma.AssignmentWhereInput = {
      truckRequirement: { ship: { organizationId: context.organizationId } },
    };
    if (query.truckRequirementId) {
      where.truckRequirementId = query.truckRequirementId;
    }
    if (query.driverId) {
      where.driverId = query.driverId;
    }
    if (query.status) {
      where.status = query.status;
    }

    const [items, total] = await Promise.all([
      prisma.assignment.findMany({
        where,
        include: ASSIGNMENT_INCLUDE,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.assignment.count({ where }),
    ]);

    return {
      items: items.map(toAssignmentDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async function getAssignment(assignmentId: string): Promise<AssignmentDto> {
    return toAssignmentDto(await resolveOwnedAssignment(assignmentId));
  }

  async function createAssignment(input: CreateAssignmentRequest): Promise<AssignmentDto> {
    const context = getRequestContext();
    await resolveTenantScopedTruckRequirement(prisma, input.truckRequirementId);

    // Driver is a TENANT_SCOPED_MODEL, so this findFirst is automatically
    // org-scoped by the extension — a cross-org driverId resolves to
    // nothing, exactly like every other cross-org reference in this app.
    const driver = await prisma.driver.findFirst({ where: { id: input.driverId } });
    if (!driver) {
      throw new NotFoundError('Driver not found.');
    }

    let assignment: AssignmentWithRelations;
    try {
      assignment = await prisma.assignment.create({
        data: {
          // Explicit, not relied-on-implicitly — same reasoning as every
          // other tenant-scoped create() in this codebase (see
          // ships.service.ts's createShip): the extension injects this at
          // runtime, but Prisma's generated create type can't see that.
          organizationId: context.organizationId,
          truckRequirementId: input.truckRequirementId,
          driverId: input.driverId,
          agreedRate: input.agreedRate,
          createdByUserId: context.userId,
        },
        include: ASSIGNMENT_INCLUDE,
      });
    } catch (error) {
      // The partial unique index (truckRequirementId, driverId) WHERE
      // status IN ('PENDING','CONFIRMED') is hand-authored SQL, not
      // declared in schema.prisma — but Postgres still reports it as a
      // standard unique_violation (SQLSTATE 23505), which Prisma still
      // maps to P2002 regardless of whether the index appears in the
      // Prisma schema. Verified by a real concurrent-create test, not
      // assumed.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(
          'This driver already has an active engagement for this requirement.',
        );
      }
      throw error;
    }

    auditLogger.record({
      type: 'assignment.created',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: assignment.id,
      metadata: { driverId: input.driverId, truckRequirementId: input.truckRequirementId },
    });

    return toAssignmentDto(assignment);
  }

  async function confirmAssignment(assignmentId: string): Promise<AssignmentDto> {
    const context = getRequestContext();
    const existing = await resolveOwnedAssignment(assignmentId);
    assertTransition(existing.status, 'CONFIRMED');

    await prisma.$transaction(async (tx) => {
      // Conditional update + affected-row-count check, not a plain
      // update() — the same atomic-race-prevention pattern already
      // chaos-tested for refresh-token rotation in Phase 1. Two
      // dispatchers confirming the same assignment simultaneously: the
      // first UPDATE ... WHERE status = 'PENDING' wins, the second
      // matches zero rows and gets a clean conflict, never a silent
      // double-confirmation.
      const assignmentUpdate = await tx.assignment.updateMany({
        where: { id: assignmentId, status: 'PENDING' },
        data: { status: 'CONFIRMED', respondedAt: new Date() },
      });
      if (assignmentUpdate.count === 0) {
        throw new ConflictError('Assignment is no longer pending.');
      }

      // Same pattern again for the driver: if this driver was confirmed
      // on a different assignment in the gap between resolving this one
      // and this transaction running, availability is no longer 'IDLE'
      // and this update matches zero rows — surfacing a clear conflict
      // instead of silently overwriting a different commitment.
      const driverUpdate = await tx.driver.updateMany({
        where: { id: existing.driverId, availability: 'IDLE' },
        data: { availability: 'CONFIRMED', currentShipId: existing.truckRequirement.shipId },
      });
      if (driverUpdate.count === 0) {
        throw new ConflictError(
          'This driver is no longer available — they may already be confirmed on another job.',
        );
      }

      await tx.assignmentAttempt.create({
        data: { assignmentId, outcome: 'CONFIRMED', recordedByUserId: context.userId },
      });
    });

    auditLogger.record({
      type: 'assignment.confirmed',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: assignmentId,
    });

    return toAssignmentDto(await resolveOwnedAssignment(assignmentId));
  }

  async function rejectAssignment(
    assignmentId: string,
    input: RejectAssignmentRequest,
  ): Promise<AssignmentDto> {
    const context = getRequestContext();
    const existing = await resolveOwnedAssignment(assignmentId);
    assertTransition(existing.status, 'REJECTED');

    const updated = await prisma.assignment.updateMany({
      where: { id: assignmentId, status: 'PENDING' },
      data: { status: 'REJECTED', respondedAt: new Date(), rejectionReason: input.reason },
    });
    if (updated.count === 0) {
      throw new ConflictError('Assignment is no longer pending.');
    }
    await prisma.assignmentAttempt.create({
      data: {
        assignmentId,
        outcome: 'REJECTED',
        notes: input.reason,
        recordedByUserId: context.userId,
      },
    });

    auditLogger.record({
      type: 'assignment.rejected',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: assignmentId,
      metadata: { reason: input.reason },
    });

    return toAssignmentDto(await resolveOwnedAssignment(assignmentId));
  }

  async function withdrawAssignment(assignmentId: string): Promise<AssignmentDto> {
    const context = getRequestContext();
    const existing = await resolveOwnedAssignment(assignmentId);
    assertTransition(existing.status, 'WITHDRAWN');

    const updated = await prisma.assignment.updateMany({
      where: { id: assignmentId, status: 'PENDING' },
      data: { status: 'WITHDRAWN' },
    });
    if (updated.count === 0) {
      throw new ConflictError('Assignment is no longer pending.');
    }

    auditLogger.record({
      type: 'assignment.withdrawn',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: assignmentId,
    });

    return toAssignmentDto(await resolveOwnedAssignment(assignmentId));
  }

  async function cancelAssignment(
    assignmentId: string,
    input: CancelAssignmentRequest,
  ): Promise<AssignmentDto> {
    const context = getRequestContext();
    const existing = await resolveOwnedAssignment(assignmentId);
    assertTransition(existing.status, 'CANCELLED');

    await prisma.$transaction(async (tx) => {
      const updated = await tx.assignment.updateMany({
        where: { id: assignmentId, status: 'CONFIRMED' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: input.reason },
      });
      if (updated.count === 0) {
        throw new ConflictError('Assignment is not currently confirmed.');
      }
      await tx.driver.updateMany({
        where: { id: existing.driverId },
        data: { availability: 'IDLE', currentShipId: null },
      });
      await revertShipIfNowShort(tx, existing.truckRequirement.shipId, context.userId);
    });

    auditLogger.record({
      type: 'assignment.cancelled',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: assignmentId,
      metadata: { reason: input.reason },
    });

    return toAssignmentDto(await resolveOwnedAssignment(assignmentId));
  }

  async function markNoShow(assignmentId: string): Promise<AssignmentDto> {
    const context = getRequestContext();
    const existing = await resolveOwnedAssignment(assignmentId);
    assertTransition(existing.status, 'NO_SHOW');

    await prisma.$transaction(async (tx) => {
      const updated = await tx.assignment.updateMany({
        where: { id: assignmentId, status: 'CONFIRMED' },
        data: { status: 'NO_SHOW', noShowAt: new Date() },
      });
      if (updated.count === 0) {
        throw new ConflictError('Assignment is not currently confirmed.');
      }
      await tx.driver.updateMany({
        where: { id: existing.driverId },
        data: { availability: 'IDLE', currentShipId: null },
      });
      await revertShipIfNowShort(tx, existing.truckRequirement.shipId, context.userId);
    });

    auditLogger.record({
      type: 'assignment.no_show',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: assignmentId,
    });

    return toAssignmentDto(await resolveOwnedAssignment(assignmentId));
  }

  async function logAttempt(
    assignmentId: string,
    input: LogAttemptRequest,
  ): Promise<AssignmentAttemptDto> {
    const context = getRequestContext();
    await resolveOwnedAssignment(assignmentId);

    // The resource this endpoint creates is the attempt, not the parent
    // assignment — returning the attempt itself (rather than the whole
    // Assignment with the caller left to dig it out of `attempts[0]`) is
    // both the more correct REST shape and lets a caller know exactly
    // which row it just created without trusting array ordering.
    const attempt = await prisma.assignmentAttempt.create({
      data: {
        assignmentId,
        outcome: input.outcome,
        notes: input.notes,
        recordedByUserId: context.userId,
      },
    });

    auditLogger.record({
      type: 'assignment.attempt_logged',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: assignmentId,
      metadata: { outcome: input.outcome },
    });

    return toAssignmentAttemptDto(attempt);
  }

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
