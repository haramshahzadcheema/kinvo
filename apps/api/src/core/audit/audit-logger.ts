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

      if (tx) {
        // Caller explicitly wants this write atomic with a business
        // mutation still in flight (see this file's own doc comment) — a
        // failure here MUST propagate and roll back that transaction, so
        // it's the one case this function doesn't swallow.
        await tx.auditLogEntry.create({
          data: {
            type: event.type,
            actorUserId: event.actorUserId,
            organizationId: event.organizationId,
            targetId: event.targetId,
            metadata: event.metadata,
          },
        });
        return;
      }

      // The far more common case: the business mutation this event
      // describes has already committed by the time record() is called —
      // every service in this codebase calls it after its own write, not
      // inside one. A transient failure writing the *audit trail* (a DB
      // blip, a pool exhaustion moment) must never turn an otherwise
      // successful mutation into a client-visible 500: the ship/assignment/
      // membership/whatever change already happened and is not undoable
      // from here, so the correct response to the caller is still success.
      // Letting this throw uncaught used to mean a request could commit a
      // real change and still receive a 500, encouraging a client retry
      // that could re-run a non-idempotent operation against state that
      // had already moved. Caught, logged at error level (so it's still
      // operationally visible — an audit gap is a real gap, just not one
      // that should overshadow a real success), never rethrown.
      try {
        await prisma.auditLogEntry.create({
          data: {
            type: event.type,
            actorUserId: event.actorUserId,
            organizationId: event.organizationId,
            targetId: event.targetId,
            metadata: event.metadata,
          },
        });
      } catch (error) {
        logger.error(
          { err: error, audit: true, ...event },
          `Failed to persist audit log entry for "${event.type}" — the underlying mutation already committed and is not affected.`,
        );
      }
    },
  };
}
