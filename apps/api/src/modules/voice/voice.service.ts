import type {
  ActiveVoiceCallDto,
  ActiveVoiceCallsResponse,
  AssignmentAttemptDto,
  ResolvedVoiceCallDto,
  VoiceCallListQuery,
  VoiceCallListResponse,
} from '@kinvo/contracts';
import { NOTIFICATION_CREATED, YELLOW_ZONE_CREATED } from '@kinvo/contracts';
import { Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import type { AssignmentsService, AttemptActor } from '../assignments/assignments.service';
import type { NotificationService } from '../notifications/notification.service';
import type { YellowZoneService } from '../yellow-zone/yellow-zone.service';
import { env } from '../../config/env';
import { ConflictError, NotFoundError } from '../../core/errors/AppError';
import type {
  PlaceVoiceCallJobData,
  ProcessVoiceWebhookJobData,
} from '../../core/queue/queues';
import { placeVoiceCallJobId, voiceCallsQueue } from '../../core/queue/queues';
import type { prisma as prismaClient } from '../../core/prisma';
import { withoutTenantScope } from '../../core/prisma';
import type { EmitToOrganization, EmitToUser } from '../../core/realtime/emitter';
import { getRequestContext, runWithRequestContext, type RequestContext } from '../../core/request-context';
import type { VoiceCallOutcome, VoiceProvider } from '../../core/voice/VoiceProvider';

export interface VoiceServiceDependencies {
  prisma: typeof prismaClient;
  voiceProvider: VoiceProvider;
  assignmentsService: AssignmentsService;
  yellowZoneService: YellowZoneService;
  notificationService: NotificationService;
  emitToOrganization: EmitToOrganization;
  emitToUser: EmitToUser;
  logger: Logger;
}

// Phase 6: who gets notified about a new Yellow Zone escalation — everyone
// who can actually act on it (yellow-zone:manage — see
// core/rbac/permissions.ts). Deliberately excludes VIEWER: an escalation
// notification without an action the recipient can take is exactly the
// "notify everyone by default" anti-pattern docs/ARCHITECTURE.md's Phase 6
// Decisions log argues against. If VIEWER ever needs its own read-only
// digest, that's a second, separately-targeted notification type, not a
// wider recipient list on this one.
const YELLOW_ZONE_ESCALATION_RECIPIENT_ROLES = ['OWNER', 'ADMIN', 'DISPATCHER'] as const;

export interface VoiceService {
  /** HTTP-triggered: validates the assignment and enqueues a placement job. Runs inside the caller's own request context. */
  placeCallForAssignment(assignmentId: string): Promise<void>;
  /** Worker-invoked: actually calls the provider and records the resulting VoiceCallPlacement. */
  executeCallPlacement(data: PlaceVoiceCallJobData): Promise<void>;
  /** Worker-invoked: resolves an already-parsed webhook signal to a terminal outcome, if one is available. */
  processWebhookSignal(data: ProcessVoiceWebhookJobData): Promise<void>;
  /** Periodic sweep: re-checks placements that never got a terminal webhook, and force-times-out ones stuck well past budget. */
  reconcileStaleAttempts(): Promise<void>;
  /** HTTP-triggered: paginated, filterable history of resolved automated calls for the Calls UI. */
  listCalls(query: VoiceCallListQuery): Promise<VoiceCallListResponse>;
  /** HTTP-triggered: calls currently in flight (no terminal outcome yet) for the Calls UI. */
  listActiveCalls(): Promise<ActiveVoiceCallsResponse>;
}

// Denormalized driver/ship context shared by both the resolved-call and
// active-call read models — same reasoning as AssignmentDto's own
// denormalization (assignment.schema.ts): the Calls UI needs to render a
// list of rows naming a driver and a destination without a second request
// per row.
const VOICE_CALL_ASSIGNMENT_CONTEXT = {
  select: {
    driverId: true,
    driver: { select: { fullName: true, phone: true } },
    truckRequirement: {
      select: {
        shipId: true,
        destination: true,
        truckType: true,
        ship: { select: { shipName: true } },
      },
    },
  },
} satisfies Prisma.AssignmentAttemptInclude['assignment'];

type VoiceCallAssignmentContext = {
  driverId: string;
  driver: { fullName: string; phone: string };
  truckRequirement: {
    shipId: string;
    destination: string;
    truckType: string;
    ship: { shipName: string };
  };
};

function toResolvedVoiceCallDto(att: {
  id: string;
  assignmentId: string;
  outcome: ResolvedVoiceCallDto['outcome'];
  notes: string | null;
  provider: string | null;
  externalCallId: string | null;
  attemptedAt: Date;
  assignment: VoiceCallAssignmentContext;
}): ResolvedVoiceCallDto {
  return {
    id: att.id,
    assignmentId: att.assignmentId,
    driverId: att.assignment.driverId,
    driverName: att.assignment.driver.fullName,
    driverPhone: att.assignment.driver.phone,
    shipId: att.assignment.truckRequirement.shipId,
    shipName: att.assignment.truckRequirement.ship.shipName,
    destination: att.assignment.truckRequirement.destination,
    truckType: att.assignment.truckRequirement.truckType,
    // Non-null by construction — every AssignmentAttempt this query selects
    // is filtered to `provider: { not: null }`, and attemptRecordFields
    // (assignments.service.ts) always sets provider and externalCallId
    // together for a system actor, never one without the other.
    provider: att.provider as string,
    externalCallId: att.externalCallId,
    outcome: att.outcome,
    notes: att.notes,
    attemptedAt: att.attemptedAt.toISOString(),
  };
}

function toActiveVoiceCallDto(placement: {
  id: string;
  assignmentId: string;
  provider: string;
  externalCallId: string;
  placedAt: Date;
  assignment: VoiceCallAssignmentContext;
}): ActiveVoiceCallDto {
  return {
    id: placement.id,
    assignmentId: placement.assignmentId,
    driverId: placement.assignment.driverId,
    driverName: placement.assignment.driver.fullName,
    driverPhone: placement.assignment.driver.phone,
    shipId: placement.assignment.truckRequirement.shipId,
    shipName: placement.assignment.truckRequirement.ship.shipName,
    destination: placement.assignment.truckRequirement.destination,
    truckType: placement.assignment.truckRequirement.truckType,
    provider: placement.provider,
    externalCallId: placement.externalCallId,
    placedAt: placement.placedAt.toISOString(),
  };
}

type VoiceCallPlacementRecord = {
  assignmentId: string;
  provider: string;
  externalCallId: string;
};

// AssignmentAttempt.externalCallId is the only unique constraint any
// AssignmentAttempt.create() call in this module can violate (its id is a
// generated cuid, never a source of collision) — so any P2002 raised from
// applyVoiceOutcome's confirm/reject/logAttempt calls is unambiguously this
// race, not a different constraint entirely.
function isDuplicateExternalCallId(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * The voice module's own idempotency model, in full, since it's spread
 * across several tables and layers:
 *
 *  1. BullMQ job id (placeVoiceCallJobId / voiceWebhookEventJobId) — the
 *     cheapest layer, stops a duplicate enqueue before it does any work at
 *     all.
 *  2. CallEAdapter's provider-level idempotencyKey (derived from
 *     callAttemptRef) — stops a duplicate *placement* from ever reaching a
 *     second real phone call, even across a worker crash-and-retry that
 *     produces a different BullMQ job.
 *  3. AssignmentAttempt.externalCallId (unique) — stops two different
 *     terminal signals for the *same call* (e.g. a webhook race with
 *     reconciliation, or two distinct webhook event types for one call)
 *     from producing two competing attempt records.
 *  4. VoiceWebhookEvent.id (primary key = the provider's own event id) —
 *     the final, cheapest check for a literal duplicate delivery of the
 *     exact same webhook.
 *
 * Each layer is independent and each is safe on its own; together they're
 * what makes "duplicate webhook," "duplicate queue job," and "worker
 * crashed mid-job" all resolve to a safe no-op rather than double-applying
 * anything or losing the outcome. See schema.prisma's VoiceCallPlacement
 * and VoiceWebhookEvent model comments for the storage side of this.
 */
export function createVoiceService({
  prisma,
  voiceProvider,
  assignmentsService,
  yellowZoneService,
  notificationService,
  emitToOrganization,
  emitToUser,
  logger,
}: VoiceServiceDependencies): VoiceService {
  // The only fields ever read off this context on the system-actor path are
  // organizationId (every tenant-scoped Prisma query) — assignmentsService's
  // confirm/reject/logAttempt never read userId/membershipId/role once
  // called with a `{ source: 'system' }` actor (see
  // assignments.service.ts's attemptRecordFields/auditActorId). These
  // placeholders exist only because RequestContext's shape requires them.
  function buildSystemRequestContext(organizationId: string): RequestContext {
    return {
      userId: 'system:voice-worker',
      organizationId,
      membershipId: 'system:voice-worker',
      role: 'OWNER',
    };
  }

  // Assignment carries its own organizationId directly (Phase 3's own
  // hardening — see schema.prisma's Assignment model comment), so this is a
  // single lookup, not a join through truckRequirement -> ship. Runs
  // outside any tenant context by design: this is exactly how the
  // organizationId to bind ONE gets discovered in the first place, for a
  // background job that started with no request at all.
  async function resolveOrganizationIdForAssignment(assignmentId: string): Promise<string> {
    return withoutTenantScope(
      'voice worker resolving organizationId for a webhook/reconciliation callback',
      async (client) => {
        const assignment = await client.assignment.findUnique({
          where: { id: assignmentId },
          select: { organizationId: true },
        });
        if (!assignment) {
          throw new NotFoundError(
            `Assignment ${assignmentId} referenced by a voice call placement no longer exists.`,
          );
        }
        return assignment.organizationId;
      },
    );
  }

  // Phase 5: a SYSTEM_ERROR attempt IS the escalation trigger — "an
  // automated call CALL-E can't resolve" (see docs/ARCHITECTURE.md's Phase
  // 5 Decisions log, Option A). The AssignmentAttempt write and the
  // YellowZoneItem it produces commit atomically, in one transaction
  // passed through to both `logAttempt` and
  // `yellowZoneService.createEscalationForAttempt` — a crash between "the
  // attempt was recorded" and "the escalation exists" must not be a
  // reachable state, so this is not two separate writes with a gap between
  // them the way VoiceWebhookEvent deliberately is (see that model's own
  // comment for why that one *is* allowed to be non-atomic).
  async function logSystemErrorWithEscalation(
    assignmentId: string,
    notes: string,
    actor: AttemptActor,
    provenance: { provider: string },
  ): Promise<AssignmentAttemptDto> {
    const context = getRequestContext();
    let escalation: Awaited<ReturnType<YellowZoneService['createEscalationForAttempt']>> = null;
    let notifications: Awaited<ReturnType<NotificationService['createForRecipients']>> = [];

    const attempt = await prisma.$transaction(async (tx) => {
      const created = await assignmentsService.logAttempt(
        assignmentId,
        { outcome: 'SYSTEM_ERROR', notes },
        actor,
        tx,
      );
      escalation = await yellowZoneService.createEscalationForAttempt(tx, {
        organizationId: context.organizationId,
        assignmentAttemptId: created.id,
        reason: notes,
        provider: provenance.provider,
      });

      // Phase 6: the notification fan-out commits in the SAME transaction
      // as the escalation it's about — see docs/ARCHITECTURE.md's Phase 6
      // Decisions log for why ("a notification must never tell a user
      // something happened when the authoritative mutation ultimately
      // rolled back"). `escalation` is null on a duplicate delivery (see
      // createEscalationForAttempt's own idempotency guard) — nothing new
      // happened, so nothing to notify anyone about either.
      if (escalation) {
        // No explicit organizationId here — Membership is in
        // core/prisma.ts's TENANT_SCOPED_MODELS, so the extension injects
        // it, same as every other query against a tenant-scoped model in
        // this codebase that doesn't repeat it by hand. Worth calling out
        // at this specific call site: if Membership were ever removed from
        // that set, this query would notify every organization's
        // OWNER/ADMIN/DISPATCHER about every other organization's
        // escalations — a severe cross-tenant leak with nothing local here
        // to catch it. Covered today by notification.test.ts's
        // "never leaks another organization's notifications".
        const recipients = await tx.membership.findMany({
          where: { role: { in: [...YELLOW_ZONE_ESCALATION_RECIPIENT_ROLES] }, status: 'ACTIVE' },
          select: { userId: true },
        });

        // Settings: honor a recipient's own opt-out. A row only exists
        // once a user has actually opened Settings (see
        // preferences.service.ts's lazy-create-on-first-read) — a user
        // with no row yet has never touched this preference, so the
        // schema default (true, "notify me") still applies; only an
        // EXISTING row explicitly set to false removes someone from this
        // list. Never the other way around (an existing row can't ADD a
        // recipient who isn't already OWNER/ADMIN/DISPATCHER above).
        const optedOut = await tx.userPreferences.findMany({
          where: {
            userId: { in: recipients.map((m) => m.userId) },
            yellowZoneEscalationNotifications: false,
          },
          select: { userId: true },
        });
        const optedOutUserIds = new Set(optedOut.map((p) => p.userId));
        const recipientUserIds = recipients
          .map((m) => m.userId)
          .filter((userId) => !optedOutUserIds.has(userId));

        notifications = await notificationService.createForRecipients(
          tx,
          recipientUserIds,
          {
            organizationId: context.organizationId,
            type: 'YELLOW_ZONE_ESCALATED',
            title: `New escalation: ${escalation.driverName}`,
            message: `${escalation.shipName} · ${escalation.destination} — ${escalation.reason}`,
            targetType: 'YELLOW_ZONE_ITEM',
            targetId: escalation.id,
          },
        );
      }

      return created;
    });

    // Emitted only after the transaction has actually committed — sockets
    // are a cache-invalidation signal, never something a client should
    // trust ahead of the database write it describes. `null` means this
    // was a duplicate delivery for an attempt that was already escalated
    // (see createEscalationForAttempt's own idempotency guard) — nothing
    // new happened, so nothing to announce.
    if (escalation) {
      emitToOrganization(context.organizationId, YELLOW_ZONE_CREATED, { item: escalation });
      for (const { userId, notification } of notifications) {
        emitToUser(userId, NOTIFICATION_CREATED, { notification });
      }
    }

    return attempt;
  }

  // Kinvo's own 5-outcome vocabulary -> the existing AttemptOutcome enum.
  // `ambiguous` has no dedicated enum value (see
  // packages/contracts/src/assignment.schema.ts) — a driver response CALL-E
  // couldn't classify as a clear yes/no is, from Kinvo's workflow's point of
  // view, exactly the same "the automated pipeline didn't resolve this;  a
  // human needs to look" situation SYSTEM_ERROR already exists for. The
  // real reason (schema validation failure, unclear speech, ...) is never
  // lost — it's preserved verbatim in the attempt's `notes`.
  async function applyVoiceOutcome(
    assignmentId: string,
    outcome: Exclude<VoiceCallOutcome, { kind: 'pending' }>,
    provenance: { provider: string; externalCallId: string },
  ): Promise<void> {
    const actor: AttemptActor = {
      source: 'system',
      provider: provenance.provider,
      externalCallId: provenance.externalCallId,
    };

    try {
      switch (outcome.kind) {
        case 'confirmed':
          await assignmentsService.confirmAssignment(assignmentId, actor);
          return;
        case 'declined':
          await assignmentsService.rejectAssignment(
            assignmentId,
            { reason: 'Driver declined during an automated confirmation call.' },
            actor,
          );
          return;
        case 'unreachable':
          await assignmentsService.logAttempt(assignmentId, { outcome: 'UNREACHABLE' }, actor);
          return;
        case 'ambiguous':
        case 'system_error':
          await logSystemErrorWithEscalation(assignmentId, outcome.reason, actor, provenance);
          return;
      }
    } catch (error) {
      // Two different terminal webhook event types for the same call (e.g.
      // call.completed and a lagging call.result_validation_failed) can be
      // processed by two different worker concurrency slots at the exact
      // same time — both pass resolvePlacement's existingAttempt check
      // (neither has committed yet) and both reach here. The loser hits
      // AssignmentAttempt.externalCallId's unique constraint, not a
      // ConflictError — the winner's attempt already captured this exact
      // outcome, so there is nothing left for the loser to do.
      if (isDuplicateExternalCallId(error)) {
        return;
      }
      if (!(error instanceof ConflictError)) {
        throw error;
      }
      // The assignment could no longer transition — a concurrent human
      // action already resolved it. The call's own outcome must still be
      // preserved as history rather than silently dropped; logAttempt has
      // no status precondition, so it always succeeds — except it can
      // still lose the same externalCallId race described above, since it
      // writes the same unique column.
      const fallbackOutcome =
        outcome.kind === 'confirmed' ? 'CONFIRMED' : outcome.kind === 'declined' ? 'REJECTED' : 'SYSTEM_ERROR';
      try {
        await assignmentsService.logAttempt(
          assignmentId,
          {
            outcome: fallbackOutcome,
            notes: `Recorded after the assignment could no longer transition directly (${error.message})`,
          },
          actor,
        );
      } catch (fallbackError) {
        if (!isDuplicateExternalCallId(fallbackError)) {
          throw fallbackError;
        }
      }
    }
  }

  // The shared core of both processWebhookSignal and reconcileStaleAttempts
  // — the only difference between "a webhook told us to check this call"
  // and "reconciliation is sweeping for calls that never got a webhook" is
  // whether a still-pending result should be forced to a timeout.
  async function resolvePlacement(
    placement: VoiceCallPlacementRecord,
    options: { forceTimeoutIfPending: boolean },
  ): Promise<void> {
    const organizationId = await resolveOrganizationIdForAssignment(placement.assignmentId);

    await runWithRequestContext(buildSystemRequestContext(organizationId), async () => {
      // Layer 3 of the idempotency model (see the module comment): if an
      // attempt already carries this externalCallId, the outcome was
      // already applied by an earlier run — nothing left to do but let the
      // placement get marked resolved below.
      const existingAttempt = await prisma.assignmentAttempt.findUnique({
        where: { externalCallId: placement.externalCallId },
      });

      if (!existingAttempt) {
        let outcome = await voiceProvider.getCallOutcome(placement.externalCallId);

        if (outcome.kind === 'pending') {
          if (!options.forceTimeoutIfPending) {
            // Genuinely still in flight and within budget — try again
            // later (another webhook delivery, or a future reconciliation
            // pass). Leaves the placement unresolved on purpose.
            return;
          }
          outcome = {
            kind: 'system_error',
            reason: `Call did not reach a terminal state within ${env.VOICE_RECONCILE_STALE_AFTER_MINUTES} minutes.`,
          };
        }

        await applyVoiceOutcome(placement.assignmentId, outcome, {
          provider: placement.provider,
          externalCallId: placement.externalCallId,
        });
      }

      await prisma.voiceCallPlacement.updateMany({
        where: { externalCallId: placement.externalCallId, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
    });
  }

  async function placeCallForAssignment(assignmentId: string): Promise<void> {
    const context = getRequestContext();
    const assignment = await assignmentsService.getAssignment(assignmentId);
    if (assignment.status !== 'PENDING') {
      throw new ConflictError(
        'Can only place an automated confirmation call for a pending assignment.',
      );
    }

    // A fresh ref per "round" of calling, derived from how many placements
    // already exist for this assignment — NOT a random id. Two concurrent
    // enqueues before the first call has resolved both compute the same
    // count (0) and land on the same ref, so CALL-E's own idempotency
    // collapses them into one real call (see CallEAdapter). A later,
    // legitimate retry after an earlier round already resolved sees a
    // higher count and gets a genuinely distinct ref, so it is never
    // mistaken for a replay of the first.
    const priorPlacementCount = await prisma.voiceCallPlacement.count({ where: { assignmentId } });
    const callAttemptRef = `${assignmentId}:${priorPlacementCount}`;

    await voiceCallsQueue.add(
      'place-call',
      { assignmentId, organizationId: context.organizationId, callAttemptRef },
      { jobId: placeVoiceCallJobId(callAttemptRef) },
    );
  }

  async function executeCallPlacement(data: PlaceVoiceCallJobData): Promise<void> {
    await runWithRequestContext(buildSystemRequestContext(data.organizationId), async () => {
      const assignment = await assignmentsService.getAssignment(data.assignmentId);
      if (assignment.status !== 'PENDING') {
        logger.info(
          { assignmentId: data.assignmentId, status: assignment.status },
          'Skipping voice call placement — assignment is no longer pending.',
        );
        return;
      }

      const handle = await voiceProvider.requestConfirmationCall({
        phone: assignment.driverPhone,
        driverName: assignment.driverName,
        shipName: assignment.shipName,
        destination: assignment.destination,
        truckType: assignment.truckType,
        rate: assignment.agreedRate ?? assignment.rate,
        rateCurrency: assignment.rateCurrency,
        metadata: {
          assignmentId: data.assignmentId,
          organizationId: data.organizationId,
          callAttemptRef: data.callAttemptRef,
        },
      });

      try {
        await prisma.voiceCallPlacement.create({
          data: {
            assignmentId: data.assignmentId,
            provider: handle.provider,
            externalCallId: handle.externalCallId,
          },
        });
      } catch (error) {
        // A retry of this exact job (same callAttemptRef -> CALL-E returned
        // the same call -> same externalCallId) after a crash between
        // "call placed" and "placement recorded" hits this unique
        // constraint — the placement already exists from the attempt that
        // actually committed. Safe to treat as already-done.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw error;
        }
      }
    });
  }

  async function processWebhookSignal(data: ProcessVoiceWebhookJobData): Promise<void> {
    const placement = await prisma.voiceCallPlacement.findUnique({
      where: { externalCallId: data.externalCallId },
    });

    if (!placement) {
      // A webhook for a call Kinvo never placed (or a placement purged by
      // future data-retention policy) — untrusted input pointing at
      // something we have no record of. Nothing to act on; not an error.
      logger.warn(
        { externalCallId: data.externalCallId, provider: data.provider },
        'Received a voice webhook for an unknown externalCallId — discarding.',
      );
      return;
    }

    if (!placement.resolvedAt) {
      await resolvePlacement(placement, { forceTimeoutIfPending: false });
    }

    // Layer 4 of the idempotency model: recorded last, and independent of
    // whether resolvePlacement did any work above — a genuine duplicate
    // delivery of this exact eventId reaches this point every time and must
    // still no-op cleanly on every replay. Requires the attempt to already
    // exist (it does, by now, on every path that didn't just return early
    // above) since the FK is not nullable.
    const attempt = await prisma.assignmentAttempt.findUnique({
      where: { externalCallId: data.externalCallId },
    });
    if (!attempt) {
      return;
    }
    try {
      await prisma.voiceWebhookEvent.create({
        data: { id: data.eventId, attemptId: attempt.id },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }
  }

  async function reconcileStaleAttempts(): Promise<void> {
    const staleBefore = new Date(Date.now() - env.VOICE_RECONCILE_STALE_AFTER_MINUTES * 60_000);
    const stalePlacements = await prisma.voiceCallPlacement.findMany({
      where: { resolvedAt: null, placedAt: { lt: staleBefore } },
      take: 100,
    });

    for (const placement of stalePlacements) {
      try {
        await resolvePlacement(placement, { forceTimeoutIfPending: true });
      } catch (error) {
        logger.error(
          { err: error, externalCallId: placement.externalCallId },
          'Failed to reconcile a stale voice call placement — will retry on the next sweep.',
        );
      }
    }
  }

  async function listCalls(query: VoiceCallListQuery): Promise<VoiceCallListResponse> {
    const context = getRequestContext();
    // AssignmentAttempt is deliberately not tenant-scoped (see
    // core/prisma.ts's TENANT_SCOPED_MODELS comment) — every access goes
    // through an already-owned Assignment, exactly like
    // assignments.service.ts's own attempt queries. `provider: { not: null
    // }` is what makes this the CALLS view rather than every human-recorded
    // contact attempt too.
    const where: Prisma.AssignmentAttemptWhereInput = {
      provider: { not: null },
      assignment: { organizationId: context.organizationId },
      ...(query.outcome ? { outcome: query.outcome } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.assignmentAttempt.findMany({
        where,
        include: { assignment: VOICE_CALL_ASSIGNMENT_CONTEXT },
        orderBy: { attemptedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.assignmentAttempt.count({ where }),
    ]);

    return {
      items: items.map(toResolvedVoiceCallDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async function listActiveCalls(): Promise<ActiveVoiceCallsResponse> {
    const context = getRequestContext();
    // Deliberately unpaginated but capped, not a full list endpoint — see
    // activeVoiceCallSchema's doc comment in packages/contracts. In
    // practice bounded by VOICE_CALLS_CONCURRENCY; `take` is defense, not
    // load-bearing.
    const placements = await prisma.voiceCallPlacement.findMany({
      where: { resolvedAt: null, assignment: { organizationId: context.organizationId } },
      include: { assignment: VOICE_CALL_ASSIGNMENT_CONTEXT },
      orderBy: { placedAt: 'desc' },
      take: 50,
    });

    return { items: placements.map(toActiveVoiceCallDto) };
  }

  return {
    placeCallForAssignment,
    executeCallPlacement,
    processWebhookSignal,
    reconcileStaleAttempts,
    listCalls,
    listActiveCalls,
  };
}
