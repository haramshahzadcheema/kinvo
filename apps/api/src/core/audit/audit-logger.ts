import type { Logger } from 'pino';
import type { AuditEvent } from './audit-events';

/**
 * The audit-logging interface Phase 1 is required to expose, even though
 * the full persisted AuditLog (docs/ARCHITECTURE.md §12) is later scope.
 * Backed by structured pino logs today — every audit event is a distinctly
 * tagged, machine-parseable log line — but callers depend only on this
 * interface. Swapping in a real AuditLog table later means changing
 * createAuditLogger's implementation, not every call site that records an
 * event: the same composition-root principle as VoiceProvider.
 */
export interface AuditLogger {
  record(event: AuditEvent): void;
}

export function createAuditLogger(logger: Logger): AuditLogger {
  return {
    record(event: AuditEvent): void {
      logger.info({ audit: true, ...event }, `audit: ${event.type}`);
    },
  };
}
