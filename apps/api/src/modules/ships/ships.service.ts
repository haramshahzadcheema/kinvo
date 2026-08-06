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
import type { Prisma } from '@prisma/client';
import type { AuditLogger } from '../../core/audit/audit-logger';
import { ConflictError, NotFoundError } from '../../core/errors/AppError';
import type { prisma as prismaClient } from '../../core/prisma';
import { getRequestContext } from '../../core/request-context';

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

type ShipWithRequirements = Prisma.ShipGetPayload<{
  include: { truckRequirements: true; documentRequirements: true };
}>;

const SHIP_INCLUDE = { truckRequirements: true, documentRequirements: true } as const;

function toTruckRequirementDto(req: {
  id: string;
  destination: string;
  truckType: string;
  quantityNeeded: number;
  rate: Prisma.Decimal | null;
  rateCurrency: string | null;
  notes: string | null;
}): TruckRequirementDto {
  return {
    id: req.id,
    destination: req.destination,
    truckType: req.truckType,
    quantityNeeded: req.quantityNeeded,
    rate: req.rate ? req.rate.toNumber() : null,
    rateCurrency: req.rateCurrency,
    notes: req.notes,
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

  async function updateShipStatus(shipId: string, status: ShipStatusValue): Promise<ShipDto> {
    const context = getRequestContext();
    const target = await resolveOwnedShip(shipId);

    if (target.status !== status && !VALID_TRANSITIONS[target.status].includes(status)) {
      throw new ConflictError(`Cannot move a ship from ${target.status} to ${status}.`, {
        from: target.status,
        to: status,
      });
    }

    const ship = await prisma.ship.update({
      where: { id: shipId },
      data: { status },
      include: SHIP_INCLUDE,
    });

    auditLogger.record({
      type: 'ship.status_changed',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: shipId,
      metadata: { previousStatus: target.status, newStatus: status },
    });

    return toShipDto(ship);
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

    const requirement = await prisma.truckRequirement.update({
      where: { id: truckRequirementId },
      data: input,
    });
    return toTruckRequirementDto(requirement);
  }

  async function removeTruckRequirement(shipId: string, truckRequirementId: string): Promise<void> {
    await resolveOwnedTruckRequirement(shipId, truckRequirementId);

    await prisma.truckRequirement.delete({ where: { id: truckRequirementId } });
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
