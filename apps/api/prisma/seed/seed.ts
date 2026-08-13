import type { YellowZoneItemDto } from '@kinvo/contracts';
import type { Container } from '../../src/core/container';
import { runWithRequestContext, type RequestContext } from '../../src/core/request-context';
import { withoutTenantScope } from '../../src/core/prisma';
import { hashPassword } from '../../src/core/security/password';
import type { AttemptActor } from '../../src/modules/assignments/assignments.service';
import type { CreatedNotification } from '../../src/modules/notifications/notification.service';
import type { Rng } from './rng';
import {
  CAPACITY_POOL,
  CARGO_TYPES,
  confirmedTranscript,
  DEMO_PASSWORD,
  demoEmail,
  DESTINATIONS,
  DOCUMENT_TYPES,
  DRIVER_FIRST_NAMES,
  DRIVER_LAST_NAMES,
  LANGUAGES_POOL,
  PRIMARY_ORG_NAME,
  PRIMARY_ORG_PEOPLE,
  REJECTION_REASONS,
  rejectedTranscript,
  REMINDER_NOTES,
  SECONDARY_ORG_NAME,
  SECONDARY_ORG_PEOPLE,
  SHIP_NAMES,
  SHIPPING_COMPANIES,
  SOFT_FAILURE_NOTES,
  SYSTEM_ERROR_REASONS,
  TRUCK_TYPES,
} from './data';

// See reset.ts's identical comment — the tenant-scoping Client Extension
// changes the client's shape enough that the plain `@prisma/client`
// `PrismaClient` type doesn't structurally match it.
type PrismaClient = typeof import('../../src/core/prisma').prisma;

const DAY_MS = 24 * 60 * 60 * 1000;

interface SeededPerson {
  userId: string;
  membershipId: string;
  organizationId: string;
  role: 'OWNER' | 'ADMIN' | 'DISPATCHER' | 'VIEWER';
  firstName: string;
  lastName: string;
  email: string;
}

interface SeededOrg {
  id: string;
  name: string;
  people: SeededPerson[];
}

export interface SeedCounts {
  organizations: number;
  users: number;
  drivers: number;
  ships: number;
  truckRequirements: number;
  documentRequirements: number;
  assignments: number;
  assignmentAttempts: number;
  yellowZoneItems: number;
  notifications: number;
  reminderCampaigns: number;
}

export interface SeedReport {
  organizations: { name: string; id: string }[];
  demoAccounts: { email: string; role: string; organizationName: string }[];
  counts: SeedCounts;
}

function actingAs<T>(person: SeededPerson, fn: () => Promise<T>): Promise<T> {
  const context: RequestContext = {
    userId: person.userId,
    organizationId: person.organizationId,
    membershipId: person.membershipId,
    role: person.role,
  };
  return runWithRequestContext(context, fn);
}

async function touch(
  prisma: PrismaClient,
  table: string,
  id: string,
  fields: Record<string, Date | null>,
): Promise<void> {
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  const setClause = entries.map(([col], i) => `"${col}" = $${i + 2}`).join(', ');
  await prisma.$executeRawUnsafe(
    `UPDATE ${table} SET ${setClause} WHERE id = $1`,
    id,
    ...entries.map(([, value]) => value),
  );
}

function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

function between(rng: Rng, start: Date, end: Date): Date {
  const startMs = start.getTime();
  const endMs = Math.max(end.getTime(), startMs + 1000);
  return new Date(startMs + rng.int(0, endMs - startMs));
}

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

export async function seedDemoData(
  prisma: PrismaClient,
  container: Container,
  rng: Rng,
): Promise<SeedReport> {
  const now = new Date();
  const counts: SeedCounts = {
    organizations: 0,
    users: 0,
    drivers: 0,
    ships: 0,
    truckRequirements: 0,
    documentRequirements: 0,
    assignments: 0,
    assignmentAttempts: 0,
    yellowZoneItems: 0,
    notifications: 0,
    reminderCampaigns: 0,
  };
  const demoAccounts: SeedReport['demoAccounts'] = [];
  let phoneCounter = 1000000;

  // ---- Organizations + people ---------------------------------------

  async function createOrg(
    orgName: string,
    people: readonly { firstName: string; lastName: string; role: SeededPerson['role']; slug: string }[],
  ): Promise<SeededOrg> {
    const owner = people.find((p) => p.role === 'OWNER');
    if (!owner) throw new Error(`${orgName} has no OWNER in its people list`);

    const auth = await container.authService.registerOrganization(
      {
        organizationName: orgName,
        email: demoEmail(owner.slug),
        password: DEMO_PASSWORD,
        firstName: owner.firstName,
        lastName: owner.lastName,
      },
      {},
    );
    counts.organizations += 1;
    counts.users += 1;

    const seededPeople: SeededPerson[] = [
      {
        userId: auth.user.id,
        membershipId: auth.membership.id,
        organizationId: auth.organization.id,
        role: 'OWNER',
        firstName: owner.firstName,
        lastName: owner.lastName,
        email: auth.user.email,
      },
    ];
    demoAccounts.push({ email: auth.user.email, role: 'OWNER', organizationName: orgName });

    for (const person of people) {
      if (person.role === 'OWNER') continue;
      const passwordHash = await hashPassword(DEMO_PASSWORD);
      const email = demoEmail(person.slug);
      const user = await prisma.user.create({
        data: { email, passwordHash, firstName: person.firstName, lastName: person.lastName },
      });
      // Membership is tenant-scoped (core/prisma.ts's TENANT_SCOPED_MODELS)
      // and no request context exists yet for a brand-new org's roster —
      // same withoutTenantScope escape hatch auth.service.ts's own
      // registerOrganization/acceptInvitation use for exactly this reason.
      const membership = await withoutTenantScope(
        "Seeding an additional demo membership — no request context exists yet for a user who isn't authenticated.",
        (client) =>
          client.membership.create({
            data: { userId: user.id, organizationId: auth.organization.id, role: person.role },
          }),
      );
      counts.users += 1;
      seededPeople.push({
        userId: user.id,
        membershipId: membership.id,
        organizationId: auth.organization.id,
        role: person.role,
        firstName: person.firstName,
        lastName: person.lastName,
        email,
      });
      demoAccounts.push({ email, role: person.role, organizationName: orgName });
    }

    return { id: auth.organization.id, name: orgName, people: seededPeople };
  }

  const primaryOrg = await createOrg(PRIMARY_ORG_NAME, PRIMARY_ORG_PEOPLE);
  const secondaryOrg = await createOrg(SECONDARY_ORG_NAME, SECONDARY_ORG_PEOPLE);

  function recipientsFor(org: SeededOrg): string[] {
    return org.people
      .filter((p) => p.role === 'OWNER' || p.role === 'ADMIN' || p.role === 'DISPATCHER')
      .map((p) => p.userId);
  }

  function dispatchersOf(org: SeededOrg): SeededPerson[] {
    return org.people.filter((p) => p.role === 'DISPATCHER' || p.role === 'OWNER' || p.role === 'ADMIN');
  }

  // ---- Drivers ---------------------------------------------------------

  interface SeededDriver {
    id: string;
    fullName: string;
    firstName: string;
    createdAt: Date;
  }

  async function createDrivers(org: SeededOrg, count: number): Promise<SeededDriver[]> {
    const actor = rng.pick(dispatchersOf(org));
    const drivers: SeededDriver[] = [];
    for (let i = 0; i < count; i += 1) {
      const firstName = rng.pick(DRIVER_FIRST_NAMES);
      const lastName = rng.pick(DRIVER_LAST_NAMES);
      phoneCounter += 1;
      const phone = `+92 3${rng.int(0, 4)}${rng.int(0, 9)}-${String(phoneCounter).padStart(7, '0')}`;
      const createdAt = daysAgo(rng.int(5, 90), now);

      const driver = await actingAs(actor, () =>
        container.driversService.createDriver({
          fullName: `${firstName} ${lastName}`,
          phone,
          licenseNumber: `LIC-${rng.int(100000, 999999)}`,
          nationalId: `${rng.int(10000, 99999)}-${rng.int(1000000, 9999999)}-${rng.int(0, 9)}`,
          truckPlate: `${rng.pick(['LES', 'KHI', 'ISB', 'LHR'])}-${rng.int(1000, 9999)}`,
          truckType: rng.pick(TRUCK_TYPES),
          capacity: rng.pick(CAPACITY_POOL),
          languages: rng.sample(LANGUAGES_POOL, rng.int(1, 3)).join(', '),
          preferredRoutes: rng.sample(DESTINATIONS, rng.int(1, 3)).join(', '),
          preferredCompanies: rng.bool(0.4)
            ? rng.sample(SHIPPING_COMPANIES, rng.int(1, 2)).join(', ')
            : undefined,
          rating: rng.float(3.0, 5.0, 1),
          notes: rng.bool(0.15) ? 'Preferred for night shifts.' : undefined,
        }),
      );

      // previousJobsCount has no create-input field (see CreateDriverRequest —
      // deliberately not client-settable); set directly here since it's a
      // plain historical stat with no state machine or invariant attached.
      // Driver is tenant-scoped (core/prisma.ts), so this still needs a
      // bound request context even though it bypasses the service layer.
      // The callback MUST be `async` (not a bare arrow returning the raw
      // PrismaPromise) — a plain `() => prisma.x.y()` returns before the
      // query ever dispatches, so by the time it actually runs, the
      // AsyncLocalStorage frame `runWithRequestContext` opened has already
      // closed and `getRequestContext()` throws. An `async` callback (even
      // with just an implicit-return, no explicit `await`) engages V8's
      // own Await machinery, which is what AsyncLocalStorage instruments —
      // service methods never hit this because they're themselves declared
      // `async function` and `await` their own Prisma calls internally.
      await actingAs(actor, async () =>
        prisma.driver.update({
          where: { id: driver.id },
          data: { previousJobsCount: rng.int(0, 140) },
        }),
      );
      await touch(prisma, 'drivers', driver.id, { createdAt, updatedAt: createdAt });

      counts.drivers += 1;
      drivers.push({ id: driver.id, fullName: driver.fullName, firstName, createdAt });
    }
    return drivers;
  }

  const primaryDrivers = await createDrivers(primaryOrg, 70);
  const secondaryDrivers = await createDrivers(secondaryOrg, 6);

  // Cosmetic-only ON_CALL/ESCALATED variety among otherwise-IDLE drivers.
  // Deliberately runs AFTER buildShips (not right after createDrivers) and
  // re-reads availability from the database rather than trusting the
  // in-memory driver list: buildShips's own EngagedTracker is a simulation
  // that doesn't know about availability changes made outside its own
  // confirm/cancel/complete calls — sprinkling ON_CALL/ESCALATED onto a
  // driver BEFORE buildShips ran (an earlier version of this function did
  // exactly that) meant the tracker could still pick that driver as
  // "idle" for a later confirmAssignment call, which then failed for real
  // (updateDriver's own guard only blocks changing AWAY from a live
  // CONFIRMED assignment — it has no way to know a driver is "cosmetically"
  // ON_CALL from this function's perspective, but confirmAssignment's own
  // `availability: 'IDLE'` conditional update correctly refuses to confirm
  // a driver that isn't actually IDLE, which is exactly what surfaced this
  // ordering bug). Reading real IDLE rows from the database after all
  // ships/assignments exist is what makes this safe by construction.
  async function sprinkleAvailability(org: SeededOrg): Promise<void> {
    const actor = rng.pick(dispatchersOf(org));
    const idleDrivers = await actingAs(actor, async () =>
      prisma.driver.findMany({ where: { availability: 'IDLE' }, select: { id: true } }),
    );
    const onCall = rng.sample(idleDrivers, Math.round(idleDrivers.length * 0.08));
    const escalated = rng.sample(
      idleDrivers.filter((d) => !onCall.includes(d)),
      Math.round(idleDrivers.length * 0.04),
    );
    for (const driver of onCall) {
      await actingAs(actor, () =>
        container.driversService.updateDriver(driver.id, { availability: 'ON_CALL' }),
      );
    }
    for (const driver of escalated) {
      await actingAs(actor, () =>
        container.driversService.updateDriver(driver.id, { availability: 'ESCALATED' }),
      );
    }
  }

  // ---- Ships + requirements + assignments + calls -----------------------

  type ShipPlan = {
    status: 'DRAFT' | 'RECRUITING' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    ageDaysRange: [number, number];
  };

  const PRIMARY_SHIP_PLAN: ShipPlan[] = [
    ...Array(3).fill({ status: 'COMPLETED', ageDaysRange: [35, 90] } as ShipPlan),
    { status: 'CANCELLED', ageDaysRange: [20, 55] },
    ...Array(4).fill({ status: 'IN_PROGRESS', ageDaysRange: [7, 25] } as ShipPlan),
    ...Array(3).fill({ status: 'CONFIRMED', ageDaysRange: [3, 12] } as ShipPlan),
    ...Array(5).fill({ status: 'RECRUITING', ageDaysRange: [1, 7] } as ShipPlan),
    ...Array(2).fill({ status: 'DRAFT', ageDaysRange: [0, 2] } as ShipPlan),
  ];

  const SECONDARY_SHIP_PLAN: ShipPlan[] = [
    { status: 'COMPLETED', ageDaysRange: [25, 60] },
    { status: 'IN_PROGRESS', ageDaysRange: [4, 15] },
    { status: 'RECRUITING', ageDaysRange: [1, 5] },
  ];

  interface EngagedTracker {
    engaged: Set<string>;
    idlePool: SeededDriver[];
  }

  function makeTracker(drivers: SeededDriver[]): EngagedTracker {
    return { engaged: new Set(), idlePool: drivers };
  }

  function pickIdle(tracker: EngagedTracker, count: number): SeededDriver[] {
    const available = tracker.idlePool.filter((d) => !tracker.engaged.has(d.id));
    const chosen = rng.sample(available, Math.min(count, available.length));
    for (const d of chosen) tracker.engaged.add(d.id);
    return chosen;
  }

  function release(tracker: EngagedTracker, driverId: string): void {
    tracker.engaged.delete(driverId);
  }

  async function buildShip(
    org: SeededOrg,
    tracker: EngagedTracker,
    plan: ShipPlan,
    shipName: string,
    usedShipNames: Set<string>,
  ): Promise<void> {
    const ageDays = rng.int(plan.ageDaysRange[0], plan.ageDaysRange[1]);
    const createdAt = daysAgo(ageDays, now);
    const actor = rng.pick(dispatchersOf(org));

    const isFuture = plan.status === 'DRAFT' || plan.status === 'RECRUITING' || plan.status === 'CONFIRMED';
    const eta = isFuture
      ? between(rng, addHours(now, 6), addHours(now, ageDays * 24 + 10 * 24))
      : between(rng, createdAt, now);
    const reportingTime = addHours(eta, -3);

    const requirementCount = rng.int(1, 3);
    const truckRequirements = Array.from({ length: requirementCount }, () => ({
      destination: rng.pick(DESTINATIONS),
      truckType: rng.pick(TRUCK_TYPES),
      quantityNeeded: rng.int(1, 4),
      rate: rng.int(15000, 65000),
      rateCurrency: 'PKR',
    }));
    const documentRequirements = rng.sample(DOCUMENT_TYPES, rng.int(0, 3)).map((documentType) => ({
      documentType,
      isRequired: true,
    }));

    const ship = await actingAs(actor, () =>
      container.shipsService.createShip({
        shipName,
        company: rng.pick(SHIPPING_COMPANIES),
        eta: eta.toISOString(),
        reportingTime: reportingTime.toISOString(),
        berth: `B-${rng.int(1, 24)}`,
        gate: `Gate ${rng.int(1, 8)}`,
        cargoType: rng.pick(CARGO_TYPES),
        truckRequirements,
        documentRequirements,
      }),
    );
    counts.ships += 1;
    counts.truckRequirements += ship.truckRequirements.length;
    counts.documentRequirements += ship.documentRequirements.length;
    await touch(prisma, 'ships', ship.id, { createdAt, updatedAt: createdAt });
    usedShipNames.add(shipName);

    if (plan.status === 'DRAFT') return;

    await actingAs(actor, () => container.shipsService.updateShipStatus(ship.id, 'RECRUITING'));

    const isFullyStaffed = plan.status !== 'RECRUITING';

    for (const req of ship.truckRequirements) {
      const wantConfirmed = isFullyStaffed
        ? req.quantityNeeded
        : rng.bool(0.7)
          ? rng.int(0, Math.max(0, req.quantityNeeded - 1))
          : 0;

      // Historical noise: a couple of terminal (non-confirmed) attempts
      // that don't count toward staffing — realistic churn before landing
      // on the drivers who actually got confirmed.
      const historyCount = rng.int(0, 2);
      for (let h = 0; h < historyCount; h += 1) {
        const [driver] = pickIdle(tracker, 1);
        if (!driver) continue;
        const outcome = rng.pick(['REJECTED', 'WITHDRAWN'] as const);
        const assignment = await actingAs(actor, () =>
          container.assignmentsService.createAssignment({
            truckRequirementId: req.id,
            driverId: driver.id,
          }),
        );
        counts.assignments += 1;
        const invitedAt = between(rng, createdAt, addHours(createdAt, 4));
        await touch(prisma, 'assignments', assignment.id, { createdAt: invitedAt, invitedAt });

        if (outcome === 'REJECTED') {
          const externalCallId = `demo-call-${rng.uuid7ish()}`;
          const reason = rng.pick(REJECTION_REASONS);
          const transcript = rejectedTranscript(driver.firstName, req.destination, reason);
          await actingAs(actor, () =>
            container.assignmentsService.rejectAssignment(
              assignment.id,
              { reason },
              { source: 'system', provider: 'CALL_E', externalCallId, transcript },
            ),
          );
          counts.assignmentAttempts += 1;
          const respondedAt = addHours(invitedAt, rng.int(1, 20));
          await touch(prisma, 'assignments', assignment.id, { updatedAt: respondedAt, respondedAt });
          await touch(prisma, 'assignment_attempts', await latestAttemptId(assignment.id), {
            attemptedAt: respondedAt,
          });
        } else {
          await actingAs(actor, () => container.assignmentsService.withdrawAssignment(assignment.id));
          await touch(prisma, 'assignments', assignment.id, {
            updatedAt: addHours(invitedAt, rng.int(1, 10)),
          });
        }
        release(tracker, driver.id);
      }

      // Confirmed engagements.
      const toConfirm = pickIdle(tracker, wantConfirmed);
      for (const driver of toConfirm) {
        const assignment = await actingAs(actor, () =>
          container.assignmentsService.createAssignment({
            truckRequirementId: req.id,
            driverId: driver.id,
          }),
        );
        counts.assignments += 1;
        const invitedAt = between(rng, createdAt, addHours(createdAt, 6));
        await touch(prisma, 'assignments', assignment.id, { createdAt: invitedAt, invitedAt });

        // 0-1 soft-failure retries before the successful confirm.
        if (rng.bool(0.35)) {
          const kind = rng.pick(['NO_ANSWER', 'BUSY'] as const);
          await actingAs(actor, () =>
            container.assignmentsService.logAttempt(
              assignment.id,
              { outcome: kind, notes: rng.pick(SOFT_FAILURE_NOTES[kind]) },
              { source: 'system', provider: 'CALL_E', externalCallId: `demo-call-${rng.uuid7ish()}` },
            ),
          );
          counts.assignmentAttempts += 1;
        }

        const externalCallId = `demo-call-${rng.uuid7ish()}`;
        const transcript = confirmedTranscript(driver.firstName, ship.shipName, req.destination);
        await actingAs(actor, () =>
          container.assignmentsService.confirmAssignment(assignment.id, {
            source: 'system',
            provider: 'CALL_E',
            externalCallId,
            transcript,
          }),
        );
        counts.assignmentAttempts += 1;
        const respondedAt = addHours(invitedAt, rng.int(1, 24));
        await touch(prisma, 'assignments', assignment.id, { updatedAt: respondedAt, respondedAt });
        await touch(prisma, 'assignment_attempts', await latestAttemptId(assignment.id), {
          attemptedAt: respondedAt,
        });
        // Driver stays 'engaged' — released only when the ship completes,
        // is cancelled, or this specific assignment is separately resolved.
      }

      // A slice of SYSTEM_ERROR -> Yellow Zone escalations, only for
      // still-open (RECRUITING) requirements — a realistic "CALL-E
      // couldn't resolve this one" case among open recruiting calls.
      if (plan.status === 'RECRUITING' && rng.bool(0.3)) {
        const [driver] = pickIdle(tracker, 1);
        if (driver) {
          const assignment = await actingAs(actor, () =>
            container.assignmentsService.createAssignment({
              truckRequirementId: req.id,
              driverId: driver.id,
            }),
          );
          counts.assignments += 1;
          const invitedAt = between(rng, createdAt, addHours(createdAt, 8));
          await touch(prisma, 'assignments', assignment.id, { createdAt: invitedAt, invitedAt });

          const severity = rng.pick(['HIGH', 'MEDIUM', 'LOW'] as const);
          const reason = rng.pick(SYSTEM_ERROR_REASONS[severity]);
          const escalatedAt = addHours(invitedAt, rng.int(1, 12));
          const escalation = await raiseEscalation(
            org,
            actor,
            assignment.id,
            reason,
            escalatedAt,
          );
          if (escalation) {
            counts.assignmentAttempts += 1;
            counts.yellowZoneItems += 1;
            counts.notifications += recipientsFor(org).length;

            // Vary resolution state: most stay open (recently escalated),
            // a third get claimed/resolved or dismissed as history.
            const resolution = rng.pickWeighted([
              ['open', 0.55],
              ['resolved', 0.3],
              ['dismissed', 0.15],
            ] as const);
            if (resolution !== 'open') {
              const claimant = rng.pick(dispatchersOf(org));
              await actingAs(claimant, () =>
                container.yellowZoneService.claimYellowZoneItem(escalation.id),
              );
              if (resolution === 'resolved') {
                await actingAs(claimant, () =>
                  container.yellowZoneService.resolveYellowZoneItem(escalation.id, {
                    resolutionNotes: 'Driver re-contacted manually and confirmed availability.',
                  }),
                );
              } else {
                await actingAs(claimant, () =>
                  container.yellowZoneService.dismissYellowZoneItem(escalation.id, {
                    resolutionNotes: 'Duplicate escalation — already handled via another call.',
                  }),
                );
              }
              await touch(prisma, 'yellow_zone_items', escalation.id, {
                updatedAt: addHours(escalatedAt, rng.int(1, 30)),
                resolvedAt: addHours(escalatedAt, rng.int(1, 30)),
              });
            }
          }
          // This driver's engagement ended in an error, not a confirmation
          // — free them back up for later ships.
          release(tracker, driver.id);
        }
      }
    }

    if (plan.status === 'RECRUITING') return;

    if (isFullyStaffed) {
      await actingAs(actor, () => container.shipsService.updateShipStatus(ship.id, 'CONFIRMED'));
      await touch(prisma, 'ships', ship.id, { updatedAt: addHours(createdAt, ageDays * 6) });
    }

    if (plan.status === 'CONFIRMED') return;

    if (plan.status === 'IN_PROGRESS' || plan.status === 'COMPLETED') {
      await actingAs(actor, () => container.shipsService.updateShipStatus(ship.id, 'IN_PROGRESS'));
      await touch(prisma, 'ships', ship.id, { updatedAt: addHours(createdAt, ageDays * 10) });
    }

    if (plan.status === 'COMPLETED') {
      const confirmedBefore = await actingAs(actor, async () =>
        prisma.assignment.findMany({
          where: { status: 'CONFIRMED', truckRequirement: { shipId: ship.id } },
          select: { id: true, driverId: true },
        }),
      );
      await actingAs(actor, () => container.shipsService.updateShipStatus(ship.id, 'COMPLETED'));
      const completedAt = addHours(now, -rng.int(1, Math.max(2, ageDays)));
      for (const { id, driverId } of confirmedBefore) {
        await touch(prisma, 'assignments', id, { updatedAt: completedAt, completedAt });
        release(tracker, driverId);
      }
      await touch(prisma, 'ships', ship.id, { updatedAt: completedAt });
    } else if (plan.status === 'CANCELLED') {
      const activeBefore = await actingAs(actor, async () =>
        prisma.assignment.findMany({
          where: { status: { in: ['PENDING', 'CONFIRMED'] }, truckRequirement: { shipId: ship.id } },
          select: { id: true, driverId: true },
        }),
      );
      await actingAs(actor, () => container.shipsService.updateShipStatus(ship.id, 'CANCELLED'));
      const cancelledAt = addHours(now, -rng.int(1, Math.max(2, ageDays)));
      for (const { id, driverId } of activeBefore) {
        await touch(prisma, 'assignments', id, {
          updatedAt: cancelledAt,
          cancelledAt,
        });
        release(tracker, driverId);
      }
      await touch(prisma, 'ships', ship.id, { updatedAt: cancelledAt });
    }
  }

  async function latestAttemptId(assignmentId: string): Promise<string> {
    const attempt = await prisma.assignmentAttempt.findFirst({
      where: { assignmentId },
      orderBy: { attemptedAt: 'desc' },
      select: { id: true },
    });
    if (!attempt) throw new Error(`No attempt found for assignment ${assignmentId}`);
    return attempt.id;
  }

  async function raiseEscalation(
    org: SeededOrg,
    actor: SeededPerson,
    assignmentId: string,
    reason: string,
    escalatedAt: Date,
  ) {
    const externalCallId = `demo-call-${rng.uuid7ish()}`;
    const systemActor: AttemptActor = { source: 'system', provider: 'CALL_E', externalCallId };

    interface EscalationResult {
      escalation: YellowZoneItemDto | null;
      notifications: CreatedNotification[];
    }

    // logAttempt/resolveOwnedAssignment both read ambient request context
    // (getRequestContext()) even though this is a system-attributed
    // attempt — only the *attempt's own* actor (recordedByUserId/provider)
    // is system-sourced; which organization's assignment this resolves
    // against still comes from the bound tenant context, same as every
    // other assignments.service.ts call in this file. The transaction
    // callback returns its result rather than assigning an outer `let` —
    // simpler control flow, and TypeScript can't narrow a `let` mutated
    // inside a nested closure back to a non-null type afterward anyway.
    const result = await actingAs(actor, async (): Promise<EscalationResult> =>
      prisma.$transaction(async (tx): Promise<EscalationResult> => {
        const attempt = await container.assignmentsService.logAttempt(
          assignmentId,
          { outcome: 'SYSTEM_ERROR', notes: reason },
          systemActor,
          tx,
        );
        await touch(prisma, 'assignment_attempts', attempt.id, { attemptedAt: escalatedAt });

        const escalation = await container.yellowZoneService.createEscalationForAttempt(tx, {
          organizationId: org.id,
          assignmentAttemptId: attempt.id,
          reason,
          provider: 'CALL_E',
        });

        if (!escalation) {
          return { escalation: null, notifications: [] };
        }

        const notifications = await container.notificationService.createForRecipients(
          tx,
          recipientsFor(org),
          {
            organizationId: org.id,
            type: 'YELLOW_ZONE_ESCALATED',
            title: `New escalation: ${escalation.driverName}`,
            message: `${escalation.shipName} · ${escalation.destination} — ${escalation.reason}`,
            targetType: 'YELLOW_ZONE_ITEM',
            targetId: escalation.id,
          },
        );
        return { escalation, notifications };
      }),
    );

    const { escalation, notifications } = result;

    if (escalation) {
      await touch(prisma, 'yellow_zone_items', escalation.id, {
        createdAt: escalatedAt,
        updatedAt: escalatedAt,
      });
      for (const { userId, notification } of notifications) {
        await touch(prisma, 'notifications', notification.id, { createdAt: escalatedAt });
        // Read/unread mix — about 40% of escalation notifications get
        // marked read by their recipient, matching "unread/read mix,
        // recent/older" from the brief.
        if (rng.bool(0.4)) {
          const recipient = org.people.find((p) => p.userId === userId);
          if (recipient) {
            await actingAs(recipient, () => container.notificationService.markRead(notification.id));
          }
        }
      }
    }

    return escalation;
  }

  async function buildShips(org: SeededOrg, drivers: SeededDriver[], plans: ShipPlan[]): Promise<void> {
    const tracker = makeTracker(drivers);
    const usedNames = new Set<string>();
    const orderedPlans = [...plans].sort((a, b) => {
      const rank: Record<ShipPlan['status'], number> = {
        COMPLETED: 0,
        CANCELLED: 1,
        IN_PROGRESS: 2,
        CONFIRMED: 3,
        RECRUITING: 4,
        DRAFT: 5,
      };
      return rank[a.status] - rank[b.status];
    });
    const availableNames = rng.shuffle(SHIP_NAMES);
    let nameIndex = 0;
    // availableNames is never empty (SHIP_NAMES has 25 entries), so the
    // modulo index is always in bounds — safe under noUncheckedIndexedAccess.
    const nextName = (): string => {
      const name = availableNames[nameIndex % availableNames.length] as string;
      nameIndex += 1;
      return name;
    };
    for (const plan of orderedPlans) {
      let shipName = nextName();
      while (usedNames.has(shipName)) {
        shipName = `${nextName()} II`;
      }
      await buildShip(org, tracker, plan, shipName, usedNames);
    }
  }

  await buildShips(primaryOrg, primaryDrivers, PRIMARY_SHIP_PLAN);
  await buildShips(secondaryOrg, secondaryDrivers, SECONDARY_SHIP_PLAN);
  await sprinkleAvailability(primaryOrg);
  await sprinkleAvailability(secondaryOrg);

  // ---- Reminder campaigns ------------------------------------------------

  async function buildReminderCampaigns(org: SeededOrg): Promise<void> {
    const actor = rng.pick(dispatchersOf(org));
    const ships = await actingAs(actor, async () =>
      prisma.ship.findMany({
        where: { status: { in: ['CONFIRMED', 'IN_PROGRESS'] } },
        select: { id: true },
      }),
    );
    if (ships.length === 0) return;
    const targets = rng.sample(ships, Math.min(ships.length, rng.int(1, 3)));
    for (const ship of targets) {
      const campaign = await actingAs(actor, () =>
        container.remindersService.createReminderCampaign({
          shipId: ship.id,
          notes: rng.pick(REMINDER_NOTES),
        }),
      );
      counts.reminderCampaigns += 1;
      const createdAt = daysAgo(rng.int(0, 5), now);
      await touch(prisma, 'reminder_campaigns', campaign.id, { createdAt, updatedAt: createdAt });

      const outcome = rng.pickWeighted([
        ['pending', 0.4],
        ['approved', 0.45],
        ['cancelled', 0.15],
      ] as const);
      if (outcome === 'approved') {
        const approver = rng.pick(dispatchersOf(org));
        await actingAs(approver, () => container.remindersService.approveReminderCampaign(campaign.id));
        await touch(prisma, 'reminder_campaigns', campaign.id, {
          updatedAt: addHours(createdAt, rng.int(1, 20)),
          approvedAt: addHours(createdAt, rng.int(1, 20)),
        });
      } else if (outcome === 'cancelled') {
        await actingAs(actor, () => container.remindersService.cancelReminderCampaign(campaign.id));
        await touch(prisma, 'reminder_campaigns', campaign.id, {
          updatedAt: addHours(createdAt, rng.int(1, 10)),
        });
      }
    }
  }

  await buildReminderCampaigns(primaryOrg);
  await buildReminderCampaigns(secondaryOrg);

  return {
    organizations: [
      { name: primaryOrg.name, id: primaryOrg.id },
      { name: secondaryOrg.name, id: secondaryOrg.id },
    ],
    demoAccounts,
    counts,
  };
}
