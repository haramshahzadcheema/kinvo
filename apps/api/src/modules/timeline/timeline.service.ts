import type { TimelineEntryDto, TimelineListQuery, TimelineListResponse } from '@kinvo/contracts';
import type { Prisma } from '@prisma/client';
import type { AuditEventType } from '../../core/audit/audit-events';
import type { prisma as prismaClient } from '../../core/prisma';
import { getRequestContext } from '../../core/request-context';

export interface TimelineServiceDependencies {
  prisma: typeof prismaClient;
}

export interface TimelineService {
  listTimeline(query: TimelineListQuery): Promise<TimelineListResponse>;
}

// The Kinvo.dc.html mockup's "Operations Timeline" is a single flat,
// org-wide feed (see its `timelineEvents` array), not a per-ship
// drill-down — so this deliberately queries across every ship, not one.
// Only operational events belong here: auth.*/invitation.*/membership.*
// are real AuditLogEntry rows too, but "X logged in" or "Y was invited" is
// account plumbing a dispatcher reviewing operations doesn't want mixed
// into a driver/ship/call activity feed.
const TIMELINE_EVENT_TYPES: readonly AuditEventType[] = [
  'ship.created',
  'ship.updated',
  'ship.status_changed',
  'ship.deleted',
  'document.added',
  'document.updated',
  'document.removed',
  'driver.created',
  'driver.updated',
  'driver.deleted',
  'assignment.created',
  'assignment.confirmed',
  'assignment.rejected',
  'assignment.withdrawn',
  'assignment.cancelled',
  'assignment.no_show',
  'assignment.completed',
  'assignment.attempt_logged',
  'yellow_zone.escalated',
  'yellow_zone.claimed',
  'yellow_zone.unclaimed',
  'yellow_zone.resolved',
  'yellow_zone.dismissed',
  'reminder_campaign.created',
  'reminder_campaign.approved',
  'reminder_campaign.cancelled',
];

const TITLES: Partial<Record<AuditEventType, string>> = {
  'ship.created': 'Ship Created',
  'ship.updated': 'Ship Updated',
  'ship.status_changed': 'Ship Status Changed',
  'ship.deleted': 'Ship Deleted',
  'document.added': 'Document Requirement Added',
  'document.updated': 'Document Requirement Updated',
  'document.removed': 'Document Requirement Removed',
  'driver.created': 'Driver Added',
  'driver.updated': 'Driver Updated',
  'driver.deleted': 'Driver Removed',
  'assignment.created': 'Driver Invited',
  'assignment.confirmed': 'Assignment Confirmed',
  'assignment.rejected': 'Assignment Rejected',
  'assignment.withdrawn': 'Assignment Withdrawn',
  'assignment.cancelled': 'Assignment Cancelled',
  'assignment.no_show': 'Driver No-Show',
  'assignment.completed': 'Assignment Completed',
  'assignment.attempt_logged': 'Confirmation Call Attempted',
  'yellow_zone.escalated': 'Escalated to Yellow Zone',
  'yellow_zone.claimed': 'Yellow Zone Item Claimed',
  'yellow_zone.unclaimed': 'Yellow Zone Item Unclaimed',
  'yellow_zone.resolved': 'Yellow Zone Item Resolved',
  'yellow_zone.dismissed': 'Yellow Zone Item Dismissed',
  'reminder_campaign.created': 'Reminder Campaign Created',
  'reminder_campaign.approved': 'Reminder Campaign Approved',
  'reminder_campaign.cancelled': 'Reminder Campaign Cancelled',
};

// Generic fallback for any type not in TITLES above (defensive — every
// TIMELINE_EVENT_TYPES member has an explicit entry today) — turns
// "yellow_zone.escalated" into "Yellow Zone Escalated" rather than showing
// raw dotted.snake_case in the UI.
function humanizeType(type: string): string {
  return type
    .split(/[._]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

type AuditRow = Prisma.AuditLogEntryGetPayload<Record<string, never>>;

export function createTimelineService({ prisma }: TimelineServiceDependencies): TimelineService {
  async function resolveActorNames(actorUserIds: readonly string[]): Promise<Map<string, string>> {
    const realUserIds = [...new Set(actorUserIds)].filter((id) => !id.startsWith('system:'));
    const users =
      realUserIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: realUserIds } },
            select: { id: true, firstName: true, lastName: true },
          });
    const names = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    // system:<provider> actors (voice.service.ts's automated attempts) —
    // never a real User row, so never resolvable from the query above.
    for (const id of actorUserIds) {
      if (id.startsWith('system:')) {
        const provider = id.slice('system:'.length);
        names.set(id, provider === 'call-e' ? 'CALL-E' : `System (${provider})`);
      }
    }
    return names;
  }

  // Batch-resolves a human `detail` string per entry via a handful of
  // grouped lookups (one query per entity type touched on this page, not
  // one per row) — bounded by page size, never N+1.
  async function resolveDetails(entries: readonly AuditRow[]): Promise<Map<string, string | null>> {
    const details = new Map<string, string | null>();

    const shipTargetIds = entries
      .filter((e) => e.type.startsWith('ship.') || e.type.startsWith('document.'))
      .map((e) => e.targetId)
      .filter((id): id is string => id !== null);
    const assignmentTargetIds = entries
      .filter((e) => e.type.startsWith('assignment.'))
      .map((e) => e.targetId)
      .filter((id): id is string => id !== null);
    const driverTargetIds = entries
      .filter((e) => e.type.startsWith('driver.'))
      .map((e) => e.targetId)
      .filter((id): id is string => id !== null);
    const yellowZoneTargetIds = entries
      .filter((e) => e.type.startsWith('yellow_zone.'))
      .map((e) => e.targetId)
      .filter((id): id is string => id !== null);
    const reminderTargetIds = entries
      .filter((e) => e.type.startsWith('reminder_campaign.'))
      .map((e) => e.targetId)
      .filter((id): id is string => id !== null);

    const [ships, assignments, drivers, yellowZoneItems, reminderCampaigns] = await Promise.all([
      shipTargetIds.length
        ? prisma.ship.findMany({
            where: { id: { in: shipTargetIds } },
            select: { id: true, shipName: true },
          })
        : Promise.resolve([]),
      assignmentTargetIds.length
        ? prisma.assignment.findMany({
            where: { id: { in: assignmentTargetIds } },
            select: {
              id: true,
              driver: { select: { fullName: true } },
              truckRequirement: {
                select: { destination: true, ship: { select: { shipName: true } } },
              },
            },
          })
        : Promise.resolve([]),
      driverTargetIds.length
        ? prisma.driver.findMany({
            where: { id: { in: driverTargetIds } },
            select: { id: true, fullName: true },
          })
        : Promise.resolve([]),
      yellowZoneTargetIds.length
        ? prisma.yellowZoneItem.findMany({
            where: { id: { in: yellowZoneTargetIds } },
            select: {
              id: true,
              reason: true,
              assignmentAttempt: {
                select: {
                  assignment: {
                    select: {
                      driver: { select: { fullName: true } },
                      truckRequirement: { select: { ship: { select: { shipName: true } } } },
                    },
                  },
                },
              },
            },
          })
        : Promise.resolve([]),
      reminderTargetIds.length
        ? prisma.reminderCampaign.findMany({
            where: { id: { in: reminderTargetIds } },
            select: { id: true, ship: { select: { shipName: true } } },
          })
        : Promise.resolve([]),
    ]);

    const shipById = new Map(ships.map((s) => [s.id, s.shipName]));
    const assignmentById = new Map(assignments.map((a) => [a.id, a]));
    const driverById = new Map(drivers.map((d) => [d.id, d.fullName]));
    const yellowZoneById = new Map(yellowZoneItems.map((y) => [y.id, y]));
    const reminderById = new Map(reminderCampaigns.map((r) => [r.id, r]));

    for (const entry of entries) {
      const metadata = (entry.metadata as Record<string, unknown> | null) ?? {};

      if (entry.type.startsWith('ship.') || entry.type.startsWith('document.')) {
        // ship.deleted's row is gone by the time this query runs — its
        // shipName was captured into metadata at delete time specifically
        // for this fallback (see ships.service.ts's deleteShip).
        const shipName =
          shipById.get(entry.targetId ?? '') ?? (metadata.shipName as string | undefined) ?? null;
        const documentType = metadata.documentType as string | undefined;
        details.set(
          entry.id,
          shipName
            ? documentType
              ? `${shipName} — ${documentType}`
              : shipName
            : null,
        );
        continue;
      }

      if (entry.type.startsWith('assignment.')) {
        const assignment = assignmentById.get(entry.targetId ?? '');
        details.set(
          entry.id,
          assignment
            ? `${assignment.driver.fullName} — ${assignment.truckRequirement.ship.shipName} (${assignment.truckRequirement.destination})`
            : null,
        );
        continue;
      }

      if (entry.type.startsWith('driver.')) {
        const fullName = driverById.get(entry.targetId ?? '') ?? (metadata.fullName as string | undefined);
        details.set(entry.id, fullName ?? null);
        continue;
      }

      if (entry.type.startsWith('yellow_zone.')) {
        const item = yellowZoneById.get(entry.targetId ?? '');
        const assignment = item?.assignmentAttempt.assignment;
        details.set(
          entry.id,
          assignment
            ? `${assignment.driver.fullName} — ${assignment.truckRequirement.ship.shipName}${item ? ` (${item.reason})` : ''}`
            : null,
        );
        continue;
      }

      if (entry.type.startsWith('reminder_campaign.')) {
        const campaign = reminderById.get(entry.targetId ?? '');
        details.set(entry.id, campaign?.ship.shipName ?? null);
        continue;
      }

      details.set(entry.id, null);
    }

    return details;
  }

  async function listTimeline(query: TimelineListQuery): Promise<TimelineListResponse> {
    const context = getRequestContext();
    const where: Prisma.AuditLogEntryWhereInput = {
      organizationId: context.organizationId,
      type: { in: [...TIMELINE_EVENT_TYPES] },
    };

    const [entries, total] = await Promise.all([
      prisma.auditLogEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.auditLogEntry.count({ where }),
    ]);

    const [actorNames, details] = await Promise.all([
      resolveActorNames(entries.map((e) => e.actorUserId)),
      resolveDetails(entries),
    ]);

    const items: TimelineEntryDto[] = entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      title: TITLES[entry.type as AuditEventType] ?? humanizeType(entry.type),
      detail: details.get(entry.id) ?? null,
      actorUserId: entry.actorUserId,
      actorName: actorNames.get(entry.actorUserId) ?? 'Unknown',
      createdAt: entry.createdAt.toISOString(),
    }));

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  return { listTimeline };
}
