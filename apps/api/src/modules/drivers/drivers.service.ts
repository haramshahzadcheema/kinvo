import type {
  CreateDriverRequest,
  DriverDto,
  DriverListQuery,
  DriverListResponse,
  UpdateDriverRequest,
} from '@kinvo/contracts';
import { Prisma } from '@prisma/client';
import type { AuditLogger } from '../../core/audit/audit-logger';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/AppError';
import type { prisma as prismaClient, TransactionClient } from '../../core/prisma';
import { getRequestContext } from '../../core/request-context';

export interface DriversServiceDependencies {
  prisma: typeof prismaClient;
  auditLogger: AuditLogger;
}

export interface DriversService {
  listDrivers(query: DriverListQuery): Promise<DriverListResponse>;
  getDriver(driverId: string): Promise<DriverDto>;
  createDriver(input: CreateDriverRequest): Promise<DriverDto>;
  updateDriver(driverId: string, input: UpdateDriverRequest): Promise<DriverDto>;
  deleteDriver(driverId: string): Promise<void>;
}

type DriverWithShip = Prisma.DriverGetPayload<{
  include: { currentShip: { select: { shipName: true } } };
}>;

const DRIVER_INCLUDE = { currentShip: { select: { shipName: true } } } as const;

function toDriverDto(driver: DriverWithShip): DriverDto {
  return {
    id: driver.id,
    fullName: driver.fullName,
    phone: driver.phone,
    licenseNumber: driver.licenseNumber,
    nationalId: driver.nationalId,
    truckPlate: driver.truckPlate,
    truckType: driver.truckType,
    capacity: driver.capacity,
    languages: driver.languages,
    preferredRoutes: driver.preferredRoutes,
    preferredCompanies: driver.preferredCompanies,
    rating: driver.rating ? driver.rating.toNumber() : null,
    previousJobsCount: driver.previousJobsCount,
    availability: driver.availability,
    currentShipId: driver.currentShipId,
    currentShipName: driver.currentShip?.shipName ?? null,
    notes: driver.notes,
    createdAt: driver.createdAt.toISOString(),
    updatedAt: driver.updatedAt.toISOString(),
  };
}

// Driver.phone is unique per organization (@@unique([organizationId,
// phone]) in schema.prisma — see the driver-pool-scope decision in
// docs/ARCHITECTURE.md). Two concurrent creates/updates for the same phone
// number race the same way the auth flows did before this session's chaos
// testing found and fixed it there (see the "catch concurrent
// unique-constraint races" commit) — applying that lesson here from the
// start instead of waiting to rediscover it.
function translatePhoneConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictError('A driver with this phone number already exists.');
  }
  return error;
}

export function createDriversService({
  prisma,
  auditLogger,
}: DriversServiceDependencies): DriversService {
  // currentShipId is client-supplied but must still resolve to a ship in
  // the caller's own organization — Ship is tenant-scoped, so this throws
  // closed (a foreign-org or nonexistent ship id fails validation) rather
  // than either silently ignoring it or letting Prisma's raw FK constraint
  // error leak through as an opaque 500.
  async function assertShipBelongsToOrg(shipId: string): Promise<void> {
    const ship = await prisma.ship.findFirst({ where: { id: shipId } });
    if (!ship) {
      throw new ValidationError('currentShipId does not refer to a ship in this organization.');
    }
  }

  // Locks this driver row for the life of the enclosing transaction before
  // updateDriver re-checks its active-assignment guard below. Closes a real
  // TOCTOU race: the guard's read and the eventual write used to be two
  // separate, unlocked statements, so a dispatcher's plain "mark IDLE" edit
  // and a concurrent confirmAssignment/cancelAssignment/markNoShow on the
  // very same driver could interleave — e.g. the guard reads "no active
  // confirmed assignment", confirmAssignment then confirms the driver onto
  // a job, and this update proceeds anyway and stomps availability back to
  // IDLE, or the reverse: a dispatcher clears an engagement here in the
  // gap right before markNoShow tries to do the same thing correctly.
  // `FOR UPDATE` isn't reachable through Prisma's query builder, so this is
  // raw SQL, manually scoped by organizationId since raw queries bypass the
  // tenant-scoping extension (see core/prisma.ts) — same precedent as
  // organizations.service.ts's assertNotLastOwnerLocked and
  // assignments.service.ts's lockShipRow. This never locks Assignment or
  // Ship, only Driver, so it can never be the second half of a deadlock
  // cycle with confirmAssignment (Assignment -> Driver) or
  // cancelAssignment/markNoShow (Ship -> Assignment -> Driver) — it only
  // ever waits on Driver, never holds Driver while waiting on the others.
  async function lockDriverRow(
    tx: TransactionClient,
    organizationId: string,
    driverId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT id FROM drivers
      WHERE id = ${driverId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
  }

  async function listDrivers(query: DriverListQuery): Promise<DriverListResponse> {
    const where: Prisma.DriverWhereInput = {};
    if (query.availability) {
      where.availability = query.availability;
    }
    if (query.truckType) {
      where.truckType = { equals: query.truckType, mode: 'insensitive' };
    }
    if (query.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { truckPlate: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.driver.findMany({
        where,
        include: DRIVER_INCLUDE,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.driver.count({ where }),
    ]);

    return {
      items: items.map(toDriverDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async function getDriver(driverId: string): Promise<DriverDto> {
    const driver = await prisma.driver.findFirst({
      where: { id: driverId },
      include: DRIVER_INCLUDE,
    });
    if (!driver) {
      throw new NotFoundError('Driver not found.');
    }
    return toDriverDto(driver);
  }

  async function createDriver(input: CreateDriverRequest): Promise<DriverDto> {
    const context = getRequestContext();

    // CONFIRMED means "genuinely confirmed onto a real Assignment" — see
    // confirmAssignment (assignments.service.ts), the only legitimate path
    // that sets it. A brand-new driver cannot have one yet (there is no
    // assignment to reference until the driver itself exists), so
    // requesting it here is always a manufactured, unbacked state, not a
    // real one — same invariant updateDriver enforces below for an
    // existing driver.
    if (input.availability === 'CONFIRMED') {
      throw new ConflictError(
        'A driver can only be marked Confirmed by confirming a real assignment, not on creation.',
      );
    }

    if (input.currentShipId) {
      await assertShipBelongsToOrg(input.currentShipId);
    }

    let driver: DriverWithShip;
    try {
      driver = await prisma.driver.create({
        data: {
          // Explicit, not relied-on-implicitly — same reasoning as every
          // other tenant-scoped create() in this codebase (see
          // organizations.service.ts's createInvitation).
          organizationId: context.organizationId,
          fullName: input.fullName,
          phone: input.phone,
          licenseNumber: input.licenseNumber,
          nationalId: input.nationalId,
          truckPlate: input.truckPlate,
          truckType: input.truckType,
          capacity: input.capacity,
          languages: input.languages,
          preferredRoutes: input.preferredRoutes,
          preferredCompanies: input.preferredCompanies,
          rating: input.rating,
          availability: input.availability,
          currentShipId: input.currentShipId,
          notes: input.notes,
        },
        include: DRIVER_INCLUDE,
      });
    } catch (error) {
      throw translatePhoneConflict(error);
    }

    await auditLogger.record({
      type: 'driver.created',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: driver.id,
      metadata: { fullName: driver.fullName },
    });

    return toDriverDto(driver);
  }

  async function updateDriver(driverId: string, input: UpdateDriverRequest): Promise<DriverDto> {
    const context = getRequestContext();

    const existing = await prisma.driver.findFirst({ where: { id: driverId } });
    if (!existing) {
      throw new NotFoundError('Driver not found.');
    }

    if (input.currentShipId) {
      await assertShipBelongsToOrg(input.currentShipId);
    }

    let driver: DriverWithShip;
    try {
      driver = await prisma.$transaction(async (tx) => {
        await lockDriverRow(tx, context.organizationId, driverId);

        // availability/currentShipId are otherwise owned by the assignment
        // state machine (confirmAssignment/cancelAssignment/markNoShow, and
        // the ship cancellation/completion cascades in ships.service.ts all
        // set both together as a side effect of a real event). This
        // endpoint must not let either one drift away from a live
        // CONFIRMED assignment out from under it — that's exactly how a
        // driver gets double-booked: marked IDLE here while still
        // genuinely committed, then picked up as "available" and confirmed
        // onto a second job. Ending a real engagement must go through
        // cancelAssignment/markNoShow, which correctly clears both fields.
        // Re-checked here, inside the same transaction as the lock above
        // and the write below, not as a separate statement beforehand —
        // see lockDriverRow's comment for the race this closes.
        if (input.availability !== undefined || input.currentShipId !== undefined) {
          const activeAssignment = await tx.assignment.findFirst({
            where: { driverId, status: 'CONFIRMED' },
            select: { truckRequirement: { select: { shipId: true } } },
          });

          if (activeAssignment) {
            const leavingConfirmed =
              input.availability !== undefined && input.availability !== 'CONFIRMED';
            const changingShip =
              input.currentShipId !== undefined &&
              input.currentShipId !== activeAssignment.truckRequirement.shipId;

            if (leavingConfirmed || changingShip) {
              throw new ConflictError(
                'This driver has an active confirmed assignment. Cancel or complete it before changing availability or ship directly.',
              );
            }
          } else if (input.availability === 'CONFIRMED') {
            // The other half of this guard: without an activeAssignment,
            // requesting CONFIRMED here would manufacture the exact
            // orphaned state the block above exists to protect against —
            // a driver that LOOKS committed to a job but has no real
            // Assignment backing it, which confirmAssignment's own
            // IDLE-gated updateMany and cancelAssignment/markNoShow's
            // unconditional reset back to IDLE (assignments.service.ts)
            // both assume can never happen. CONFIRMED is only ever
            // legitimately reached by confirming a real assignment.
            throw new ConflictError(
              'A driver can only be marked Confirmed by confirming a real assignment — there is no active confirmed assignment for this driver.',
            );
          }
        }

        return tx.driver.update({
          where: { id: driverId },
          data: {
            fullName: input.fullName,
            phone: input.phone,
            licenseNumber: input.licenseNumber,
            nationalId: input.nationalId,
            truckPlate: input.truckPlate,
            truckType: input.truckType,
            capacity: input.capacity,
            languages: input.languages,
            preferredRoutes: input.preferredRoutes,
            preferredCompanies: input.preferredCompanies,
            rating: input.rating,
            availability: input.availability,
            currentShipId: input.currentShipId,
            notes: input.notes,
          },
          include: DRIVER_INCLUDE,
        });
      });
    } catch (error) {
      throw translatePhoneConflict(error);
    }

    await auditLogger.record({
      type: 'driver.updated',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: driverId,
    });

    return toDriverDto(driver);
  }

  async function deleteDriver(driverId: string): Promise<void> {
    const context = getRequestContext();

    const existing = await prisma.driver.findFirst({ where: { id: driverId } });
    if (!existing) {
      throw new NotFoundError('Driver not found.');
    }

    // Assignment.driverId is onDelete: Restrict — a driver with live
    // assignment history must never be silently deletable out from under
    // it. Same shape as ships.service.ts's removeTruckRequirement:
    // proactively checked for the common case (a specific message), with
    // the P2003 catch below as defense-in-depth for the check-then-delete
    // race and for historical (non-active) assignments, which the FK still
    // blocks even though this proactive check only looks for active ones.
    const activeCount = await prisma.assignment.count({
      where: { driverId, status: { in: ['PENDING', 'CONFIRMED'] } },
    });
    if (activeCount > 0) {
      throw new ConflictError('Cannot delete a driver with active assignments. Cancel them first.');
    }

    try {
      await prisma.driver.delete({ where: { id: driverId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictError(
          'Cannot delete a driver with active assignments. Cancel them first.',
        );
      }
      throw error;
    }

    await auditLogger.record({
      type: 'driver.deleted',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: driverId,
    });
  }

  return { listDrivers, getDriver, createDriver, updateDriver, deleteDriver };
}
