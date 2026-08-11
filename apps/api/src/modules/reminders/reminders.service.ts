import type {
  CreateReminderCampaignRequest,
  ReminderCampaignDto,
  ReminderCampaignListQuery,
  ReminderCampaignListResponse,
} from '@kinvo/contracts';
import { Prisma } from '@prisma/client';
import type { AuditLogger } from '../../core/audit/audit-logger';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/AppError';
import type { prisma as prismaClient } from '../../core/prisma';
import { getRequestContext } from '../../core/request-context';

export interface RemindersServiceDependencies {
  prisma: typeof prismaClient;
  auditLogger: AuditLogger;
}

export interface RemindersService {
  listReminderCampaigns(query: ReminderCampaignListQuery): Promise<ReminderCampaignListResponse>;
  getReminderCampaign(id: string): Promise<ReminderCampaignDto>;
  createReminderCampaign(input: CreateReminderCampaignRequest): Promise<ReminderCampaignDto>;
  approveReminderCampaign(id: string): Promise<ReminderCampaignDto>;
  cancelReminderCampaign(id: string): Promise<ReminderCampaignDto>;
}

const REMINDER_CAMPAIGN_INCLUDE = {
  ship: { select: { shipName: true, gate: true, reportingTime: true } },
  createdByUser: { select: { firstName: true, lastName: true } },
  approvedByUser: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ReminderCampaignInclude;

type ReminderCampaignWithContext = Prisma.ReminderCampaignGetPayload<{
  include: typeof REMINDER_CAMPAIGN_INCLUDE;
}>;

export function createRemindersService({
  prisma,
  auditLogger,
}: RemindersServiceDependencies): RemindersService {
  // Live, not a snapshot — matches TruckRequirement's own confirmedCount
  // semantics (see ships.service.ts's loadRequirementCounts comment).
  // currentConfirmedDriverCount on a PENDING_APPROVAL campaign must always
  // reflect right now, since nothing has been approved yet to freeze.
  async function countConfirmedDrivers(shipId: string): Promise<number> {
    return prisma.driver.count({ where: { currentShipId: shipId, availability: 'CONFIRMED' } });
  }

  async function toDto(campaign: ReminderCampaignWithContext): Promise<ReminderCampaignDto> {
    return {
      id: campaign.id,
      shipId: campaign.shipId,
      shipName: campaign.ship.shipName,
      shipGate: campaign.ship.gate,
      shipReportingTime: campaign.ship.reportingTime?.toISOString() ?? null,
      status: campaign.status,
      notes: campaign.notes,
      currentConfirmedDriverCount: await countConfirmedDrivers(campaign.shipId),
      createdByUserId: campaign.createdByUserId,
      createdByUserName: `${campaign.createdByUser.firstName} ${campaign.createdByUser.lastName}`,
      approvedByUserId: campaign.approvedByUserId,
      approvedByUserName: campaign.approvedByUser
        ? `${campaign.approvedByUser.firstName} ${campaign.approvedByUser.lastName}`
        : null,
      approvedAt: campaign.approvedAt?.toISOString() ?? null,
      confirmedDriverCountAtApproval: campaign.confirmedDriverCountAtApproval,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
    };
  }

  // Tenant-scoped via the Prisma extension (ReminderCampaign is in
  // TENANT_SCOPED_MODELS) — `findFirst({ where: { id } })` alone is
  // already org-safe, matching yellow-zone.service.ts's
  // resolveOwnedYellowZoneItem exactly.
  async function resolveOwnedCampaign(id: string): Promise<ReminderCampaignWithContext> {
    const campaign = await prisma.reminderCampaign.findFirst({
      where: { id },
      include: REMINDER_CAMPAIGN_INCLUDE,
    });
    if (!campaign) {
      throw new NotFoundError('Reminder campaign not found.');
    }
    return campaign;
  }

  async function listReminderCampaigns(
    query: ReminderCampaignListQuery,
  ): Promise<ReminderCampaignListResponse> {
    const where: Prisma.ReminderCampaignWhereInput = query.status
      ? { status: query.status }
      : {};

    const [campaigns, total] = await Promise.all([
      prisma.reminderCampaign.findMany({
        where,
        include: REMINDER_CAMPAIGN_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.reminderCampaign.count({ where }),
    ]);

    return {
      items: await Promise.all(campaigns.map(toDto)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async function getReminderCampaign(id: string): Promise<ReminderCampaignDto> {
    return toDto(await resolveOwnedCampaign(id));
  }

  async function createReminderCampaign(
    input: CreateReminderCampaignRequest,
  ): Promise<ReminderCampaignDto> {
    const context = getRequestContext();

    // Tenant-scoped via the Prisma extension, same as
    // resolveOwnedTruckRequirement's `findFirst` pattern — a shipId from
    // another organization 404s here rather than reaching the create call
    // below with a foreign key Prisma would otherwise happily accept.
    const ship = await prisma.ship.findFirst({ where: { id: input.shipId } });
    if (!ship) {
      throw new NotFoundError('Ship not found.');
    }

    // One live campaign per ship at a time — a second "report 30 minutes
    // early" request for a ship that already has one pending review would
    // just be duplicate noise for whoever approves it, not a meaningful
    // second reminder.
    const existing = await prisma.reminderCampaign.findFirst({
      where: { shipId: input.shipId, status: 'PENDING_APPROVAL' },
    });
    if (existing) {
      throw new ValidationError('This ship already has a reminder campaign awaiting approval.');
    }

    const created = await prisma.reminderCampaign.create({
      data: {
        organizationId: context.organizationId,
        shipId: input.shipId,
        notes: input.notes ?? null,
        createdByUserId: context.userId,
      },
      include: REMINDER_CAMPAIGN_INCLUDE,
    });

    await auditLogger.record({
      type: 'reminder_campaign.created',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: created.id,
    });

    return toDto(created);
  }

  async function approveReminderCampaign(id: string): Promise<ReminderCampaignDto> {
    const context = getRequestContext();
    const campaign = await resolveOwnedCampaign(id);

    // Snapshot taken before the conditional update, not after — the count
    // this campaign is approved "for" is the state at the moment of
    // approval, and re-reading it post-update would just be the same
    // number with an extra query, not a more correct one.
    const confirmedDriverCountAtApproval = await countConfirmedDrivers(campaign.shipId);

    const updated = await prisma.reminderCampaign.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: {
        status: 'SENT',
        approvedByUserId: context.userId,
        approvedAt: new Date(),
        confirmedDriverCountAtApproval,
      },
    });
    if (updated.count === 0) {
      throw new ConflictError('This campaign has already been approved or cancelled.');
    }

    await auditLogger.record({
      type: 'reminder_campaign.approved',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: id,
    });

    return toDto(await resolveOwnedCampaign(id));
  }

  async function cancelReminderCampaign(id: string): Promise<ReminderCampaignDto> {
    const context = getRequestContext();
    await resolveOwnedCampaign(id);

    const updated = await prisma.reminderCampaign.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: { status: 'CANCELLED' },
    });
    if (updated.count === 0) {
      throw new ConflictError('Only a campaign awaiting approval can be cancelled.');
    }

    await auditLogger.record({
      type: 'reminder_campaign.cancelled',
      actorUserId: context.userId,
      organizationId: context.organizationId,
      targetId: id,
    });

    return toDto(await resolveOwnedCampaign(id));
  }

  return {
    listReminderCampaigns,
    getReminderCampaign,
    createReminderCampaign,
    approveReminderCampaign,
    cancelReminderCampaign,
  };
}
