import type {
  AssignmentAttemptDto,
  AssignmentDto,
  AssignmentListQuery,
  AssignmentListResponse,
  AssignmentStatusValue,
  AttemptOutcomeValue,
  CancelAssignmentRequest,
  CreateAssignmentRequest,
  RejectAssignmentRequest,
} from '@kinvo/contracts';
import { Prisma } from '@prisma/client';
import {
  lockTruckRequirementRow,
  resolveTenantScopedTruckRequirement,
  revertShipIfNowShort,
} from '../ships/ships.service';
import type { AuditLogger } from '../../core/audit/audit-logger';
import { ConflictError, NotFoundError } from '../../core/errors/AppError';
import type { prisma as prismaClient, TransactionClient } from '../../core/prisma';
import { getRequestContext } from '../../core/request-context';
import type { CallTranscript } from '../../core/voice/VoiceProvider';

export interface AssignmentsServiceDependencies {
  prisma: typeof prismaClient;
  auditLogger: AuditLogger;
}

// Every confirm/reject/log-attempt write needs to know who's responsible
// for it, for two things: AssignmentAttempt.recordedByUserId (nullable,
// human-only) and the audit log's actorUserId (required, never null).
// Every existing HTTP call site (routes -> controllers) supplies neither
// — it relies on the default below, which reads the authenticated
// dispatcher out of the ambient request context, exactly the pre-Phase-4
// behavior. The only caller that ever supplies this explicitly is
// modules/voice's worker code, which has no HTTP request or human user to
// read a context from — it resolves the assignment's own organizationId
// out of the database first, binds a request context scoped to that
// organization (see voice.service.ts), and then passes `{ source:
// 'system', ... }` here so the resulting attempt is honestly attributed
// to the voice provider that actually produced it, not to a borrowed
// human identity. A discriminated union, not an optional bag of fields,
// so "provider without externalCallId" (or vice versa) can't be
// constructed at all.
export type AttemptActor =
  | { source: 'human' }
  | {
      source: 'system';
      provider: string;
      externalCallId: string;
      // Real conversation data from the call this attempt resolves — see
      // core/voice/outcomeTranslation.ts's extractTranscript. Optional
      // (not every VoiceCallOutcome variant carries one, and a system
      // error never does) — omitted means "not applicable," the same as
      // null once persisted, never a signal to distinguish.
      transcript?: CallTranscript | null;
    };

const DEFAULT_ATTEMPT_ACTOR: AttemptActor = { source: 'human' };

export interface LogAttemptInput {
  outcome: AttemptOutcomeValue;
  notes?: string;
}

export interface AssignmentsService {
  listAssignments(query: AssignmentListQuery): Promise<AssignmentListResponse>;
  getAssignment(assignmentId: string): Promise<AssignmentDto>;
  createAssignment(input: CreateAssignmentRequest): Promise<AssignmentDto>;
  confirmAssignment(assignmentId: string, actor?: AttemptActor): Promise<AssignmentDto>;
  rejectAssignment(
    assignmentId: string,
    input: RejectAssignmentRequest,
    actor?: AttemptActor,
  ): Promise<AssignmentDto>;
  withdrawAssignment(assignmentId: string): Promise<AssignmentDto>;
  cancelAssignment(assignmentId: string, input: CancelAssignmentRequest): Promise<AssignmentDto>;
  markNoShow(assignmentId: string): Promise<AssignmentDto>;
  logAttempt(
    assignmentId: string,
    input: LogAttemptInput,
    actor?: AttemptActor,
    tx?: TransactionClient,
  ): Promise<AssignmentAttemptDto>;
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
      ship: { select: { shipName: true, status: true } },
    },
  },
  attempts: { orderBy: { attemptedAt: 'desc' } },
  // Only ever 0 or 1 rows in practice — a second placement can't be made
  // while one is already unresolved (placeCallForAssignment only enqueues
  // for a PENDING assignment, and the assignment stays PENDING while a
  // call is in flight) — `take: 1` is defensive, not load-bearing.
  voiceCallPlacements: {
    where: { resolvedAt: null },
    orderBy: { placedAt: 'desc' },
    take: 1,
    select: { provider: true, placedAt: true },
  },
} satisfies Prisma.AssignmentInclude;

type AssignmentWithRelations = Prisma.AssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

// A ship in a terminal state can never transition again — both COMPLETED
// and CANCELLED map to an empty list in ships.service.ts's own
// VALID_TRANSITIONS — so once confirmed terminal here, there is no race
// window later in the same request to defend against. This guards against
// two real gaps: createAssignment could otherwise create a fresh PENDING
// assignment after a cancelled ship's cascade (cascadeShipCancellation)
// has already run and finished — the cascade only touches assignments
// that existed at the moment it ran, so a brand-new one afterward is
// invisible to it — and confirmAssignment could then confirm that
// assignment, permanently marking a driver CONFIRMED/unavailable against a
// shipment that will never move again, with no system-driven way back to
// IDLE.
const TERMINAL_SHIP_STATUSES: readonly string[] = ['COMPLETED', 'CANCELLED'];

function assertShipAcceptsAssignments(shipStatus: string): void {
  if (TERMINAL_SHIP_STATUSES.includes(shipStatus)) {
    throw new ConflictError(
      `Cannot manage driver assignments — this ship is already ${shipStatus.toLowerCase()}.`,
    );
  }
}

// Splits an AttemptActor into the two things AssignmentAttempt.create()
// actually needs. A system attempt is never attributed to a borrowed
// human id — recordedByUserId stays genuinely null, exactly the state
// this column was already nullable for (see the model comment in
// schema.prisma).
function attemptRecordFields(
  actor: AttemptActor,
  humanUserId: string,
): {
  recordedByUserId: string | null;
  provider: string | null;
  externalCallId: string | null;
  transcriptSummary: string | null;
  transcriptTurns: Prisma.InputJsonValue | undefined;
} {
  if (actor.source === 'system') {
    return {
      recordedByUserId: null,
      provider: actor.provider,
      externalCallId: actor.externalCallId,
      transcriptSummary: actor.transcript?.summary ?? null,
      // undefined (omitted), not null, when there's no transcript to
      // store — same convention as AuditLogEntry.metadata's own optional
      // Json? field (see audit-logger.ts): passing undefined lets the
      // column default to SQL NULL rather than writing a JSON `null`
      // literal, which is a different, unwanted value for a Json? column.
      transcriptTurns: actor.transcript
        ? (actor.transcript.turns as unknown as Prisma.InputJsonValue)
        : undefined,
    };
  }
  return {
    recordedByUserId: humanUserId,
    provider: null,
    externalCallId: null,
    transcriptSummary: null,
    transcriptTurns: undefined,
  };
}

// AuditEvent.actorUserId is required and has no foreign key (see
// AuditLogEntry's schema comment) — free to hold a sentinel string, not
// just a real user id. `system:{provider}` is a deliberately
// unmistakable, greppable marker: a human reading an audit trail should
// never wonder whether "system:CALL_E" was actually a person.
function auditActorId(actor: AttemptActor, humanUserId: string): string {
  return actor.source === 'system' ? `system:${actor.provider}` : humanUserId;
}

function toAssignmentAttemptDto(att: {
  id: string;
  outcome: AssignmentWithRelations['attempts'][number]['outcome'];
  notes: string | null;
  attemptedAt: Date;
  provider: string | null;
}): AssignmentAttemptDto {
  return {
    id: att.id,
    outcome: att.outcome,
    notes: att.notes,
    attemptedAt: att.attemptedAt.toISOString(),
    provider: att.provider,
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
    pendingVoiceCall: a.voiceCallPlacements[0]
      ? {
          provider: a.voiceCallPlacements[0].provider,
          placedAt: a.voiceCallPlacements[0].placedAt.toISOString(),
        }
      : null,
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

  // Establishes a canonical Ship -> Assignment -> Driver lock-acquisition
  // order, matching updateShipStatus's cascade in ships.service.ts (which
  // locks the Ship row via its own update() first, then cascades into
  // Assignment/Driver updates). Without this, cancelAssignment/markNoShow
  // would take Assignment then Driver then (conditionally, inside
  // revertShipIfNowShort) Ship locks — the exact reverse order. Two
  // transactions each waiting on a lock the other already holds is
  // Postgres's definition of a deadlock (SQLSTATE 40P01, surfaced by
  // Prisma as error code P2034) — confirmed reachable by tracing both
  // code paths' lock order, not assumed. Taking this lock unconditionally
  // up front, even on the code path where revertShipIfNowShort ultimately
  // decides not to write to the ship, is what pins the order for every
  // call through this function so the cycle can't form. Raw SQL because
  // `FOR UPDATE` isn't reachable through Prisma's query builder; manually
  // scoped by organizationId since raw queries bypass the tenant-scoping
  // extension in core/prisma.ts — same precedent as
  // organizations.service.ts's assertNotLastOwnerLocked.
  async function lockShipRow(
    tx: TransactionClient,
    organizationId: string,
    shipId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT id FROM ships
      WHERE id = ${shipId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
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
    const requirement = await resolveTenantScopedTruckRequirement(prisma, input.truckRequirementId);
    assertShipAcceptsAssignments(requirement.ship.status);

    // Driver is a TENANT_SCOPED_MODEL, so this findFirst is automatically
    // org-scoped by the extension — a cross-org driverId resolves to
    // nothing, exactly like every other cross-org reference in this app.
    const driver = await prisma.driver.findFirst({ where: { id: input.driverId } });
    if (!driver) {
      throw new NotFoundError('Driver not found.');
    }

    let assignment: AssignmentWithRelations;
    try {
      // Locks the truck requirement row before inserting — closes the
      // other half of the TOCTOU race lockTruckRequirementRow's comment
      // describes: without this, a new PENDING assignment could land in
      // the gap of a concurrent updateTruckRequirement destination/truck-
      // type change's guard check, exactly the scenario that guard exists
      // to prevent.
      assignment = await prisma.$transaction(async (tx) => {
        await lockTruckRequirementRow(tx, requirement.shipId, input.truckRequirementId);
        return tx.assignment.create({
          data: {
            // Explicit, not relied-on-implicitly — same reasoning as
            // every other tenant-scoped create() in this codebase (see
            // ships.service.ts's createShip): the extension injects this
            // at runtime, but Prisma's generated create type can't see
            // that.
            organizationId: context.organizationId,
            truckRequirementId: input.truckRequirementId,
            driverId: input.driverId,
            agreedRate: input.agreedRate,
            createdByUserId: context.userId,
          },
          include: ASSIGNMENT_INCLUDE,
        });
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

    await auditLogger.record({
      type: 'assignment.created',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: assignment.id,
      metadata: { driverId: input.driverId, truckRequirementId: input.truckRequirementId },
    });

    return toAssignmentDto(assignment);
  }

  async function confirmAssignment(
    assignmentId: string,
    actor: AttemptActor = DEFAULT_ATTEMPT_ACTOR,
  ): Promise<AssignmentDto> {
    const context = getRequestContext();
    const existing = await resolveOwnedAssignment(assignmentId);
    assertTransition(existing.status, 'CONFIRMED');
    assertShipAcceptsAssignments(existing.truckRequirement.ship.status);

    await prisma.$transaction(async (tx) => {
      // Locks the truck requirement row first — closes the TOCTOU race
      // lockTruckRequirementRow's comment describes: without this, a
      // concurrent updateTruckRequirement quantityNeeded-floor guard
      // could read a stale confirmedCount and let quantityNeeded drop
      // below the count this confirm is about to create.
      await lockTruckRequirementRow(tx, existing.truckRequirement.shipId, existing.truckRequirementId);

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
        data: { assignmentId, outcome: 'CONFIRMED', ...attemptRecordFields(actor, context.userId) },
      });
    });

    await auditLogger.record({
      type: 'assignment.confirmed',
      actorUserId: auditActorId(actor, context.userId),
      organizationId: context.organizationId,
      targetId: assignmentId,
    });

    return toAssignmentDto(await resolveOwnedAssignment(assignmentId));
  }

  async function rejectAssignment(
    assignmentId: string,
    input: RejectAssignmentRequest,
    actor: AttemptActor = DEFAULT_ATTEMPT_ACTOR,
  ): Promise<AssignmentDto> {
    const context = getRequestContext();
    const existing = await resolveOwnedAssignment(assignmentId);
    assertTransition(existing.status, 'REJECTED');

    // Conditional update + attempt record as one atomic unit — these were
    // previously two independent statements, so a crash (or an unrelated
    // concurrent transition, since the previous version had no update to
    // roll back if the crash landed between them) between "assignment
    // rejected" and "attempt logged" could leave a REJECTED assignment with
    // no corresponding attempt row, silently dropping part of its history.
    // Matches confirmAssignment's existing pattern.
    await prisma.$transaction(async (tx) => {
      const updated = await tx.assignment.updateMany({
        where: { id: assignmentId, status: 'PENDING' },
        data: { status: 'REJECTED', respondedAt: new Date(), rejectionReason: input.reason },
      });
      if (updated.count === 0) {
        throw new ConflictError('Assignment is no longer pending.');
      }
      await tx.assignmentAttempt.create({
        data: {
          assignmentId,
          outcome: 'REJECTED',
          notes: input.reason,
          ...attemptRecordFields(actor, context.userId),
        },
      });
    });

    await auditLogger.record({
      type: 'assignment.rejected',
      actorUserId: auditActorId(actor, context.userId),
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

    await auditLogger.record({
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
      await lockShipRow(tx, context.organizationId, existing.truckRequirement.shipId);

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
      await revertShipIfNowShort(tx, auditLogger, existing.truckRequirement.shipId, context.userId);
    });

    await auditLogger.record({
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
      await lockShipRow(tx, context.organizationId, existing.truckRequirement.shipId);

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
      await revertShipIfNowShort(tx, auditLogger, existing.truckRequirement.shipId, context.userId);
    });

    await auditLogger.record({
      type: 'assignment.no_show',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: assignmentId,
    });

    return toAssignmentDto(await resolveOwnedAssignment(assignmentId));
  }

  async function logAttempt(
    assignmentId: string,
    input: LogAttemptInput,
    actor: AttemptActor = DEFAULT_ATTEMPT_ACTOR,
    tx?: TransactionClient,
  ): Promise<AssignmentAttemptDto> {
    const context = getRequestContext();
    await resolveOwnedAssignment(assignmentId);

    // Optional external transaction — same shape as auditLogger.record's
    // own `tx?` parameter, for the same reason: a caller that needs this
    // write to commit-or-rollback atomically with something else (Phase
    // 5's Yellow Zone escalation, created alongside a SYSTEM_ERROR attempt
    // — see voice.service.ts) supplies its own `tx`; every existing call
    // site (routes -> controllers, with no such requirement) omits it and
    // gets the original single-statement-write behavior unchanged.
    const client = tx ?? prisma;

    // The resource this endpoint creates is the attempt, not the parent
    // assignment — returning the attempt itself (rather than the whole
    // Assignment with the caller left to dig it out of `attempts[0]`) is
    // both the more correct REST shape and lets a caller know exactly
    // which row it just created without trusting array ordering.
    const attempt = await client.assignmentAttempt.create({
      data: {
        assignmentId,
        outcome: input.outcome,
        notes: input.notes,
        ...attemptRecordFields(actor, context.userId),
      },
    });

    await auditLogger.record(
      {
        type: 'assignment.attempt_logged',
        actorUserId: auditActorId(actor, context.userId),
        organizationId: context.organizationId,
        targetId: assignmentId,
        metadata: { outcome: input.outcome },
      },
      tx,
    );

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
