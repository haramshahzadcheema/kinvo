import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createAuditLogger } from '../../src/core/audit/audit-logger';
import type { TransactionClient } from '../../src/core/prisma';

function fakeLogger(): Logger {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as Logger;
}

const event = {
  type: 'ship.created' as const,
  actorUserId: 'user-1',
  organizationId: 'org-1',
  targetId: 'ship-1',
};

describe('audit logger — post-commit write failures never surface as a caller-visible error', () => {
  it('does not throw when the ambient (no-tx) write fails — the mutation it describes already committed', async () => {
    const failingCreate = vi
      .fn()
      .mockRejectedValue(new Error('Connection terminated unexpectedly'));
    const fakePrisma = { auditLogEntry: { create: failingCreate } } as never;
    const logger = fakeLogger();
    const auditLogger = createAuditLogger(logger, fakePrisma);

    await expect(auditLogger.record(event)).resolves.toBeUndefined();
    expect(failingCreate).toHaveBeenCalledTimes(1);
    // Still operationally visible — an audit gap is a real gap, just not
    // one that should overshadow the mutation's own success.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ audit: true, type: 'ship.created' }),
      expect.stringContaining('Failed to persist audit log entry'),
    );
  });

  it('still resolves the write on the happy path, unchanged', async () => {
    const succeedingCreate = vi.fn().mockResolvedValue({});
    const fakePrisma = { auditLogEntry: { create: succeedingCreate } } as never;
    const auditLogger = createAuditLogger(fakeLogger(), fakePrisma);

    await auditLogger.record(event);
    expect(succeedingCreate).toHaveBeenCalledTimes(1);
  });

  it('DOES propagate a failure when a `tx` is supplied — this write is meant to be atomic with the caller’s own still-open transaction, so a failure here must still roll it back', async () => {
    const failingTxCreate = vi.fn().mockRejectedValue(new Error('unique constraint violated'));
    const fakeTx = { auditLogEntry: { create: failingTxCreate } } as unknown as TransactionClient;
    const fakePrisma = {
      auditLogEntry: { create: vi.fn() },
    } as never;
    const auditLogger = createAuditLogger(fakeLogger(), fakePrisma);

    await expect(auditLogger.record(event, fakeTx)).rejects.toThrow('unique constraint violated');
    expect(failingTxCreate).toHaveBeenCalledTimes(1);
  });
});
