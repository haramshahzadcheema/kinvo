import type {
  NotificationDto,
  NotificationListQuery,
  NotificationListResponse,
  NotificationTargetTypeValue,
  NotificationTypeValue,
  NotificationUnreadCount,
} from '@kinvo/contracts';
import { NOTIFICATION_READ } from '@kinvo/contracts';
import { Prisma } from '@prisma/client';
import { NotFoundError } from '../../core/errors/AppError';
import type { EmitToUser } from '../../core/realtime/emitter';
import type { prisma as prismaClient, TransactionClient } from '../../core/prisma';
import { getRequestContext } from '../../core/request-context';

export interface NotificationServiceDependencies {
  prisma: typeof prismaClient;
  emitToUser: EmitToUser;
}

export interface CreateNotificationInput {
  organizationId: string;
  type: NotificationTypeValue;
  title: string;
  message: string;
  targetType: NotificationTargetTypeValue;
  targetId: string;
}

// Pairs each created notification with the recipient it belongs to —
// NotificationDto (the public contract type) deliberately omits userId,
// since a user's own inbox never needs to see whose notification it is
// beyond "mine." The caller (voice.service.ts) needs it anyway, to know
// which user room to emit each one to post-commit — this internal-only
// return shape exists for exactly that, not exposed over HTTP.
export interface CreatedNotification {
  userId: string;
  notification: NotificationDto;
}

export interface NotificationService {
  listNotifications(query: NotificationListQuery): Promise<NotificationListResponse>;
  getUnreadCount(): Promise<NotificationUnreadCount>;
  markRead(id: string): Promise<NotificationDto>;
  markAllRead(): Promise<{ count: number }>;
  /**
   * Internal, worker-facing entry point — called only from voice.service.ts
   * (today), inside the SAME transaction as the domain event that triggers
   * it (e.g. the YellowZoneItem escalation), exactly mirroring
   * yellow-zone.service.ts's createEscalationForAttempt. Never exposed over
   * HTTP. Returns the created rows (not just a count) so the caller can
   * emit realtime events per recipient AFTER the transaction commits —
   * this function itself never emits, matching the established
   * "post-commit emit, done by the caller" pattern.
   *
   * `recipientUserIds` is expected to be small (an organization's
   * OWNER/ADMIN/DISPATCHER membership, not its whole user base) — a bounded
   * per-recipient loop, not a queue, is the right shape at this scale (see
   * docs/ARCHITECTURE.md's Phase 6 Decisions log).
   */
  createForRecipients(
    tx: TransactionClient,
    recipientUserIds: string[],
    input: CreateNotificationInput,
  ): Promise<CreatedNotification[]>;
}

function toNotificationDto(row: {
  id: string;
  type: string;
  title: string;
  message: string;
  targetType: string;
  targetId: string;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDto {
  return {
    id: row.id,
    type: row.type as NotificationTypeValue,
    title: row.title,
    message: row.message,
    targetType: row.targetType as NotificationTargetTypeValue,
    targetId: row.targetId,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createNotificationService({
  prisma,
  emitToUser,
}: NotificationServiceDependencies): NotificationService {
  async function listNotifications(query: NotificationListQuery): Promise<NotificationListResponse> {
    const context = getRequestContext();
    // Tenant scoping (organizationId) comes from the Prisma extension
    // automatically — userId does NOT, so it's added explicitly here.
    // Without this line, any authenticated member of the organization
    // could read every other member's private notifications; the
    // extension has no concept of "whose" a row is, only "which org's."
    const where: Prisma.NotificationWhereInput = {
      userId: context.userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.notification.count({ where }),
    ]);

    return {
      items: items.map(toNotificationDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async function getUnreadCount(): Promise<NotificationUnreadCount> {
    const context = getRequestContext();
    const count = await prisma.notification.count({
      where: { userId: context.userId, readAt: null },
    });
    return { count };
  }

  async function markRead(id: string): Promise<NotificationDto> {
    const context = getRequestContext();

    // Same conditional-update-plus-affected-row-count shape as every other
    // state transition in this codebase (see yellow-zone.service.ts) —
    // `userId: context.userId` in the WHERE is what makes this both the
    // ownership check AND the mutation in one round trip: a notification
    // that exists but belongs to someone else matches zero rows, exactly
    // like a notification that doesn't exist at all, so the two cases are
    // indistinguishable from the response — no existence leak.
    const updated = await prisma.notification.updateMany({
      where: { id, userId: context.userId, readAt: null },
      data: { readAt: new Date() },
    });

    if (updated.count === 0) {
      // Could be "already read" or "not yours"/"doesn't exist" — resolve
      // which by re-checking existence+ownership only (never leaking
      // whether it exists for a DIFFERENT user).
      const existing = await prisma.notification.findFirst({
        where: { id, userId: context.userId },
      });
      if (!existing) {
        throw new NotFoundError('Notification not found.');
      }
      // Already read — idempotent, return the current row rather than
      // erroring; marking an already-read notification read again is not
      // a conflict, just a no-op (unlike Yellow Zone's claim/resolve,
      // there's no meaningful "someone else got there first" race to
      // surface to the user here).
      return toNotificationDto(existing);
    }

    const item = await prisma.notification.findFirstOrThrow({ where: { id, userId: context.userId } });
    emitToUser(context.userId, NOTIFICATION_READ, {});
    return toNotificationDto(item);
  }

  async function markAllRead(): Promise<{ count: number }> {
    const context = getRequestContext();
    const updated = await prisma.notification.updateMany({
      where: { userId: context.userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (updated.count > 0) {
      emitToUser(context.userId, NOTIFICATION_READ, {});
    }
    return { count: updated.count };
  }

  async function createForRecipients(
    tx: TransactionClient,
    recipientUserIds: string[],
    input: CreateNotificationInput,
  ): Promise<CreatedNotification[]> {
    const created: CreatedNotification[] = [];
    for (const userId of recipientUserIds) {
      try {
        const row = await tx.notification.create({
          data: {
            organizationId: input.organizationId,
            userId,
            type: input.type,
            title: input.title,
            message: input.message,
            targetType: input.targetType,
            targetId: input.targetId,
          },
        });
        created.push({ userId, notification: toNotificationDto(row) });
      } catch (error) {
        // The @@unique([userId, targetType, targetId, type]) constraint is
        // what makes a duplicate call for the same escalation (a genuine
        // concurrency edge case, not the common path — see this
        // function's own doc comment) a safe no-op per recipient, exactly
        // mirroring createEscalationForAttempt's own P2002 handling in
        // yellow-zone.service.ts.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    return created;
  }

  return {
    listNotifications,
    getUnreadCount,
    markRead,
    markAllRead,
    createForRecipients,
  };
}
