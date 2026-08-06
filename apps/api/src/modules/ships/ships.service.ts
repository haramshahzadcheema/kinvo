import type {
  CreateShipRequest,
  DocumentRequirementDto,
  DocumentRequirementInput,
  ShipDto,
  ShipListQuery,
  ShipListResponse,
  ShipStatusValue,
  TruckRequirementDto,
  TruckRequirementInput,
  UpdateShipRequest,
} from '@kinvo/contracts';
import { Prisma } from '@prisma/client';
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

export interface ShipsServiceDependencies {
  prisma: typeof prismaClient;
  auditLogger: AuditLogger;
}

export interface ShipsService {
  listShips(query: ShipListQuery): Promise<ShipListResponse>;
  getShip(shipId: string): Promise<ShipDto>;
  createShip(input: CreateShipRequest): Promise<ShipDto>;
  updateShip(shipId: string, input: UpdateShipRequest): Promise<ShipDto>;
  updateShipStatus(shipId: string, status: ShipStatusValue): Promise<ShipDto>;
  deleteShip(shipId: string): Promise<void>;
  addTruckRequirement(shipId: string, input: TruckRequirementInput): Promise<TruckRequirementDto>;
  updateTruckRequirement(
    shipId: string,
    truckRequirementId: string,
    input: Partial<TruckRequirementInput>,
  ): Promise<TruckRequirementDto>;
  removeTruckRequirement(shipId: string, truckRequirementId: string): Promise<void>;
  addDocumentRequirement(
    shipId: string,
    input: DocumentRequirementInput,
  ): Promise<DocumentRequirementDto>;
  updateDocumentRequirement(
    shipId: string,
    documentRequirementId: string,
    input: Partial<DocumentRequirementInput>,
  ): Promise<DocumentRequirementDto>;
  removeDocumentRequirement(shipId: string, documentRequirementId: string): Promise<void>;
}

// DRAFT -> RECRUITING -> CONFIRMED -> IN_PROGRESS -> COMPLETED, CANCELLED
// reachable from any pre-COMPLETED state — enforced here, not left
// implicit, per docs/ARCHITECTURE.md §3's note on why status machines
// belong in the service layer explicitly.
const VALID_TRANSITIONS: Record<ShipStatusValue, readonly ShipStatusValue[]> = {
  DRAFT: ['RECRUITING', 'CANCELLED'],
  RECRUITING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

// Phase 3: each requirement's assignments are fetched (status only) so
// confirmedCount/pendingCount can be derived in toTruckRequirementDto
// below, rather than stored as columns that could drift from the real
// Assignment rows. Volumes per requirement are small (tens, not
// thousands), so reducing an in-memory array is the right call here, not
// a filtered relation count — see docs/ARCHITECTURE.md's Phase 3
// Decisions log.
const SHIP_INCLUDE = {
  truckRequirements: { include: { assignments: { select: { status: true } } } },
  documentRequirements: true,
} as const;

type ShipWithRequirements = Prisma.ShipGetPayload<{ include: typeof SHIP_INCLUDE }>;

function toTruckRequirementDto(req: {
  id: string;
  destination: string;
  truckType: string;
  quantityNeeded: number;
  rate: Prisma.Decimal | null;
  rateCurrency: string | null;
  notes: string | null;
  assignments: { status: string }[];
}): TruckRequirementDto {
  return {
    id: req.id,
    destination: req.destination,
    truckType: req.truckType,
    quantityNeeded: req.quantityNeeded,
    rate: req.rate ? req.rate.toNumber() : null,
    rateCurrency: req.rateCurrency,
    notes: req.notes,
    confirmedCount: req.assignments.filter((a) => a.status === 'CONFIRMED').length,
    pendingCount: req.assignments.filter((a) => a.status === 'PENDING').length,
  };
}

function toDocumentRequirementDto(req: {
  id: string;
  documentType: string;
  isRequired: boolean;
}): DocumentRequirementDto {
  return { id: req.id, documentType: req.documentType, isRequired: req.isRequired };
}

function toShipDto(ship: ShipWithRequirements): ShipDto {
  return {
    id: ship.id,
    shipName: ship.shipName,
    company: ship.company,
    eta: ship.eta?.toISOString() ?? null,
    reportingTime: ship.reportingTime?.toISOString() ?? null,
    berth: ship.berth,
    gate: ship.gate,
    cargoType: ship.cargoType,
    status: ship.status,
    notes: ship.notes,
    truckRequirements: ship.truckRequirements.map(toTruckRequirementDto),
    documentRequirements: ship.documentRequirements.map(toDocumentRequirementDto),
    createdAt: ship.createdAt.toISOString(),
    updatedAt: ship.updatedAt.toISOString(),
  };
}

// Phase 3: assignments.service.ts needs to resolve a TruckRequirement's
// tenant ownership from a flat `/api/v1/assignments` resource that has no
// shipId in its URL to work from (unlike ships.routes.ts's nested
// sub-resource routes, which already have one). Exported here rather than
// reimplemented in assignments.service.ts so there is exactly one
// implementation of "how do we know a truck requirement belongs to this
// organization" — the same reasoning that keeps resolveOwnedTruckRequirement
// itself a single function rather than one per call site.
//
// Deliberately a single relational `findFirst` with a nested `ship: {
// organizationId }` filter, not the two-separate-calls pattern
// resolveOwnedTruckRequirement uses — that pattern exists there because it
// already has a client-supplied shipId to cross-check the requirement
// against; this function doesn't, so there's nothing to cross-check
// beyond org ownership itself, and one query expresses that directly.
export async function resolveTenantScopedTruckRequirement(
  prisma: typeof prismaClient,
  truckRequirementId: string,
) {
  const context = getRequestContext();
  const requirement = await prisma.truckRequirement.findFirst({
    where: { id: truckRequirementId, ship: { organizationId: context.organizationId } },
    include: { ship: true },
  });
  if (!requirement) {
    throw new NotFoundError('Truck requirement not found.');
  }
  return requirement;
}

export function createShipsService({
  prisma,
  auditLogger,
}: ShipsServiceDependencies): ShipsService {
  // Every truck/document requirement mutation goes through this first —
  // Ship is tenant-scoped by the Prisma extension, so a shipId belonging
  // to another organization resolves to nothing (404, not a leak). Once
  // resolved, the requirement is addressed by its own id directly; a
  // client-supplied shipId is never trusted on its own for the requirement
  // models, which aren't themselves tenant-scoped (see core/prisma.ts).
  async function resolveOwnedShip(shipId: string) {
    const ship = await prisma.ship.findFirst({ where: { id: shipId } });
    if (!ship) {
      throw new NotFoundError('Ship not found.');
    }
    return ship;
  }

  async function listShips(query: ShipListQuery): Promise<ShipListResponse> {
    const where: Prisma.ShipWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.search) {
      where.OR = [
        { shipName: { contains: query.search, mode: 'insensitive' } },
        { company: { contains: query.search, mode: 'insensitive' } },
        // A dispatcher's most common lookup is "who's going to X" — the
        // destination lives on TruckRequirement, not Ship, so this needs an
        // explicit relation filter rather than a plain column match.
        {
          truckRequirements: {
            some: { destination: { contains: query.search, mode: 'insensitive' } },
          },
        },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.ship.findMany({
        where,
        include: SHIP_INCLUDE,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.ship.count({ where }),
    ]);

    return {
      items: items.map(toShipDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async function getShip(shipId: string): Promise<ShipDto> {
    const ship = await prisma.ship.findFirst({ where: { id: shipId }, include: SHIP_INCLUDE });
    if (!ship) {
      throw new NotFoundError('Ship not found.');
    }
    return toShipDto(ship);
  }

  async function createShip(input: CreateShipRequest): Promise<ShipDto> {
    const context = getRequestContext();

    const ship = await prisma.ship.create({
      data: {
        // Explicit, not relied-on-implicitly — same reasoning as
        // organizations.service.ts's createInvitation: the extension
        // auto-injects this at runtime, but Prisma's generated create
        // types can't see that.
        organizationId: context.organizationId,
        shipName: input.shipName,
        company: input.company,
        eta: input.eta ? new Date(input.eta) : undefined,
        reportingTime: input.reportingTime ? new Date(input.reportingTime) : undefined,
        berth: input.berth,
        gate: input.gate,
        cargoType: input.cargoType,
        notes: input.notes,
        truckRequirements: input.truckRequirements
          ? { create: input.truckRequirements }
          : undefined,
        documentRequirements: input.documentRequirements
          ? { create: input.documentRequirements }
          : undefined,
      },
      include: SHIP_INCLUDE,
    });

    auditLogger.record({
      type: 'ship.created',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: ship.id,
      metadata: { shipName: ship.shipName },
    });

    return toShipDto(ship);
  }

  async function updateShip(shipId: string, input: UpdateShipRequest): Promise<ShipDto> {
    const context = getRequestContext();
    await resolveOwnedShip(shipId);

    const ship = await prisma.ship.update({
      where: { id: shipId },
      data: {
        shipName: input.shipName,
        company: input.company,
        eta: input.eta === undefined ? undefined : input.eta ? new Date(input.eta) : null,
        reportingTime:
          input.reportingTime === undefined
            ? undefined
            : input.reportingTime
              ? new Date(input.reportingTime)
              : null,
        berth: input.berth,
        gate: input.gate,
        cargoType: input.cargoType,
        notes: input.notes,
      },
      include: SHIP_INCLUDE,
    });

    auditLogger.record({
      type: 'ship.updated',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: shipId,
    });

    return toShipDto(ship);
  }

  // Phase 3: cancelling or completing a ship must clean up its live
  // assignments — otherwise a cancelled ship leaves a trail of stale
  // PENDING/CONFIRMED assignments and drivers permanently stuck showing
  // as unavailable for no real reason. Implemented as direct prisma calls
  // here (not a call into assignments.service.ts) deliberately: this is a
  // mechanical bulk state change, not business-rule logic, and doing it
  // here avoids a circular service dependency — assignments.service.ts
  // already depends on ships.service.ts (for tenant-scoped truck
  // requirement resolution), so the reverse dependency doesn't exist.
  //
  // Takes `tx`, not the outer `prisma`, and is only ever called from
  // within updateShipStatus's own $transaction below — a process crash
  // between "ship marked CANCELLED" and "its assignments/drivers cleaned
  // up" must not be possible; either the whole sequence commits or none
  // of it does.
  async function cascadeShipCancellation(tx: TransactionClient, shipId: string): Promise<void> {
    // Captured only to know which drivers to look at afterward — CONFIRMED
    // specifically, because that's the only status that ever set a
    // driver's availability in the first place. A PENDING assignment never
    // touched it, so a driver whose only connection to this ship is a
    // still-PENDING invite must not have an unrelated, independently-set
    // ON_CALL/ESCALATED flag clobbered back to IDLE just because this ship
    // got cancelled.
    const confirmedDriverIds = await tx.assignment.findMany({
      where: { status: 'CONFIRMED', truckRequirement: { shipId } },
      select: { driverId: true },
    });

    // Filtered by status directly in the WHERE clause, re-checked at the
    // moment of the write — not by an id list captured earlier. An
    // assignment that was independently transitioned (rejected, withdrawn,
    // individually cancelled) in the gap between the select above and this
    // update simply no longer matches this condition and is correctly left
    // alone, instead of having its real terminal status silently overwritten.
    const cancelled = await tx.assignment.updateMany({
      where: { status: { in: ['PENDING', 'CONFIRMED'] }, truckRequirement: { shipId } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'Ship cancelled' },
    });
    if (cancelled.count === 0) return;

    const driverIds = [...new Set(confirmedDriverIds.map((a) => a.driverId))];
    if (driverIds.length === 0) return;

    // currentShipId: shipId re-checked at write time — a driver whose
    // CONFIRMED assignment here was independently cancelled/no-showed in
    // the interim already had this correctly reset by that action, so
    // their currentShipId no longer points here and this update naturally
    // skips them instead of double-resetting.
    await tx.driver.updateMany({
      where: { id: { in: driverIds }, currentShipId: shipId },
      data: { availability: 'IDLE', currentShipId: null },
    });
  }

  async function cascadeShipCompletion(tx: TransactionClient, shipId: string): Promise<void> {
    const confirmedDriverIds = await tx.assignment.findMany({
      where: { status: 'CONFIRMED', truckRequirement: { shipId } },
      select: { driverId: true },
    });

    const completed = await tx.assignment.updateMany({
      where: { status: 'CONFIRMED', truckRequirement: { shipId } },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (completed.count === 0) return;

    const driverIds = [...new Set(confirmedDriverIds.map((a) => a.driverId))];
    if (driverIds.length === 0) return;

    await tx.driver.updateMany({
      where: { id: { in: driverIds }, currentShipId: shipId },
      data: { availability: 'IDLE', currentShipId: null },
    });
  }

  async function updateShipStatus(shipId: string, status: ShipStatusValue): Promise<ShipDto> {
    const context = getRequestContext();
    const target = await resolveOwnedShip(shipId);

    if (target.status !== status && !VALID_TRANSITIONS[target.status].includes(status)) {
      throw new ConflictError(`Cannot move a ship from ${target.status} to ${status}.`, {
        from: target.status,
        to: status,
      });
    }

    // The status flip and its cascade are one atomic unit — a crash
    // between them must never be able to leave a CANCELLED/COMPLETED ship
    // with assignments and drivers that still think they're live.
    await prisma.$transaction(async (tx) => {
      await tx.ship.update({ where: { id: shipId }, data: { status } });

      if (status === 'CANCELLED') {
        await cascadeShipCancellation(tx, shipId);
      } else if (status === 'COMPLETED') {
        await cascadeShipCompletion(tx, shipId);
      }
    });

    auditLogger.record({
      type: 'ship.status_changed',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: shipId,
      metadata: { previousStatus: target.status, newStatus: status },
    });

    // Re-fetch rather than reuse the update() result above: the cascade
    // functions may have changed related Assignment rows that affect the
    // DTO's derived confirmedCount/pendingCount, which the pre-cascade
    // `ship` object wouldn't reflect.
    const finalShip = await prisma.ship.findFirst({ where: { id: shipId }, include: SHIP_INCLUDE });
    if (!finalShip) {
      throw new NotFoundError('Ship not found.');
    }
    return toShipDto(finalShip);
  }

  async function deleteShip(shipId: string): Promise<void> {
    const context = getRequestContext();
    await resolveOwnedShip(shipId);

    // Cascades to truckRequirements/documentRequirements (onDelete: Cascade
    // in schema.prisma) and to any Driver.currentShipId pointing here
    // (onDelete: SetNull) — a deleted ship never leaves a dangling FK.
    await prisma.ship.delete({ where: { id: shipId } });

    auditLogger.record({
      type: 'ship.deleted',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: shipId,
    });
  }

  async function addTruckRequirement(
    shipId: string,
    input: TruckRequirementInput,
  ): Promise<TruckRequirementDto> {
    await resolveOwnedShip(shipId);
    const requirement = await prisma.truckRequirement.create({
      data: { shipId, ...input },
      include: { assignments: { select: { status: true } } },
    });
    return toTruckRequirementDto(requirement);
  }

  // A truck/document requirement row belonging to another organization —
  // or to a different ship than the URL claims — must be exactly as
  // invisible as one that doesn't exist at all. Same principle as the rest
  // of this codebase's tenant isolation (see tenant-isolation.test.ts:
  // "org A cannot read org B's membership by ID — it's invisible, not
  // forbidden"). Every failure path here throws the identical message, so
  // no response lets a caller distinguish "doesn't exist," "exists under a
  // different ship," or "exists in another org."
  async function resolveOwnedTruckRequirement(shipId: string, truckRequirementId: string) {
    const existing = await prisma.truckRequirement.findUnique({
      where: { id: truckRequirementId },
    });
    const owned =
      existing?.shipId === shipId && (await prisma.ship.findFirst({ where: { id: shipId } }));
    if (!existing || !owned) {
      throw new NotFoundError('Truck requirement not found.');
    }
    return existing;
  }

  async function resolveOwnedDocumentRequirement(shipId: string, documentRequirementId: string) {
    const existing = await prisma.documentRequirement.findUnique({
      where: { id: documentRequirementId },
    });
    const owned =
      existing?.shipId === shipId && (await prisma.ship.findFirst({ where: { id: shipId } }));
    if (!existing || !owned) {
      throw new NotFoundError('Document requirement not found.');
    }
    return existing;
  }

  async function updateTruckRequirement(
    shipId: string,
    truckRequirementId: string,
    input: Partial<TruckRequirementInput>,
  ): Promise<TruckRequirementDto> {
    await resolveOwnedTruckRequirement(shipId, truckRequirementId);

    // Phase 3: once a requirement has any active (PENDING/CONFIRMED)
    // assignment, its destination/truckType are exactly the facts a
    // driver was told and agreed to — changing them after the fact would
    // silently invalidate what that driver confirmed to, without telling
    // them. quantityNeeded remains editable, but never below the number
    // already confirmed: silently orphaning a confirmed driver is never
    // acceptable, only an explicit cancellation is.
    if (input.destination !== undefined || input.truckType !== undefined) {
      const activeCount = await prisma.assignment.count({
        where: { truckRequirementId, status: { in: ['PENDING', 'CONFIRMED'] } },
      });
      if (activeCount > 0) {
        throw new ConflictError(
          'Cannot change destination or truck type once drivers have been assigned to this requirement.',
        );
      }
    }

    if (input.quantityNeeded !== undefined) {
      const confirmedCount = await prisma.assignment.count({
        where: { truckRequirementId, status: 'CONFIRMED' },
      });
      if (input.quantityNeeded < confirmedCount) {
        throw new ConflictError(
          `Cannot reduce quantity below ${confirmedCount} confirmed driver(s). Cancel assignments first.`,
          { confirmedCount },
        );
      }
    }

    const requirement = await prisma.truckRequirement.update({
      where: { id: truckRequirementId },
      data: input,
      include: { assignments: { select: { status: true } } },
    });
    return toTruckRequirementDto(requirement);
  }

  async function removeTruckRequirement(shipId: string, truckRequirementId: string): Promise<void> {
    await resolveOwnedTruckRequirement(shipId, truckRequirementId);

    const activeCount = await prisma.assignment.count({
      where: { truckRequirementId, status: { in: ['PENDING', 'CONFIRMED'] } },
    });
    if (activeCount > 0) {
      throw new ConflictError(
        'Cannot delete a destination with active driver assignments. Cancel them first.',
      );
    }

    try {
      await prisma.truckRequirement.delete({ where: { id: truckRequirementId } });
    } catch (error) {
      // Defense in depth against the check-then-delete race above: the
      // schema's onDelete: Restrict FK is the actual safety net if an
      // assignment is created in the gap between the count check and the
      // delete. Translated to the same clean conflict rather than a raw
      // FK-violation 500, matching the proactive-error-translation
      // discipline established for Driver.phone's P2002 race.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictError(
          'Cannot delete a destination with active driver assignments. Cancel them first.',
        );
      }
      throw error;
    }
  }

  async function addDocumentRequirement(
    shipId: string,
    input: DocumentRequirementInput,
  ): Promise<DocumentRequirementDto> {
    await resolveOwnedShip(shipId);
    const requirement = await prisma.documentRequirement.create({
      data: { shipId, documentType: input.documentType, isRequired: input.isRequired },
    });
    return toDocumentRequirementDto(requirement);
  }

  async function updateDocumentRequirement(
    shipId: string,
    documentRequirementId: string,
    input: Partial<DocumentRequirementInput>,
  ): Promise<DocumentRequirementDto> {
    await resolveOwnedDocumentRequirement(shipId, documentRequirementId);

    const requirement = await prisma.documentRequirement.update({
      where: { id: documentRequirementId },
      data: input,
    });
    return toDocumentRequirementDto(requirement);
  }

  async function removeDocumentRequirement(
    shipId: string,
    documentRequirementId: string,
  ): Promise<void> {
    await resolveOwnedDocumentRequirement(shipId, documentRequirementId);

    await prisma.documentRequirement.delete({ where: { id: documentRequirementId } });
  }

  return {
    listShips,
    getShip,
    createShip,
    updateShip,
    updateShipStatus,
    deleteShip,
    addTruckRequirement,
    updateTruckRequirement,
    removeTruckRequirement,
    addDocumentRequirement,
    updateDocumentRequirement,
    removeDocumentRequirement,
  };
}
