import type { Logger } from 'pino';
import type { AuditEvent } from './audit-events';
import type { prisma as prismaClient, TransactionClient } from '../prisma';

/**
 * The audit-logging interface. Every event is both logged (structured pino
 * line, for operational grepping) and persisted to the `AuditLogEntry`
 * table (for durable, queryable business history — see
 * docs/ARCHITECTURE.md §12). Async because persistence is a real write, not
 * a fire-and-forget log call; callers must await it.
 *
 * The optional `tx` lets a caller that's already inside a `$transaction`
 * record the audit entry as part of the same atomic unit as the business
 * write it's describing — e.g. `revertShipIfNowShort` in
 * assignments.service.ts, where the ship-status change and its audit
 * record must commit or roll back together. Omitting `tx` runs the write
 * against the ambient tenant-scoped `prisma` client instead, for the
 * (much more common) case of logging after a transaction has already
 * committed.
 */
export interface AuditLogger {
  record(event: AuditEvent, tx?: TransactionClient): Promise<void>;
}

export function createAuditLogger(logger: Logger, prisma: typeof prismaClient): AuditLogger {
  return {
    async record(event: AuditEvent, tx?: TransactionClient): Promise<void> {
      logger.info({ audit: true, ...event }, `audit: ${event.type}`);

      const client = tx ?? prisma;
      await client.auditLogEntry.create({
        data: {
          type: event.type,
          actorUserId: event.actorUserId,
          organizationId: event.organizationId,
          targetId: event.targetId,
          metadata: event.metadata,
        },
      });
    },
  };
}
