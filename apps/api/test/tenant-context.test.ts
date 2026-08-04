import { describe, expect, it } from 'vitest';
import {
  getTenantContext,
  runWithTenantContext,
  tryGetTenantContext,
} from '../src/core/tenant-context';

describe('tenant-context', () => {
  it('throws when read outside of a tenant-scoped context', () => {
    expect(() => getTenantContext()).toThrowError(/outside of a tenant-scoped request context/);
  });

  it('returns undefined from tryGetTenantContext outside of a context', () => {
    expect(tryGetTenantContext()).toBeUndefined();
  });

  it('makes the bound context available for the duration of the call', () => {
    const observed = runWithTenantContext({ organizationId: 'org-1' }, () => getTenantContext());
    expect(observed).toEqual({ organizationId: 'org-1' });
  });

  it('does not leak context after the bound call returns', () => {
    runWithTenantContext({ organizationId: 'org-1' }, () => undefined);
    expect(tryGetTenantContext()).toBeUndefined();
  });

  it('isolates context across concurrent async call graphs — the actual guarantee that matters', async () => {
    // This is the exact scenario the whole primitive exists for: two
    // "requests" for different organizations, interleaved by the event
    // loop, must never see each other's tenant. If this test can be made
    // to fail, tenant isolation is broken.
    async function simulateRequest(organizationId: string): Promise<string> {
      return runWithTenantContext({ organizationId }, async () => {
        // Yield to the event loop mid-flight so the two simulated
        // "requests" genuinely interleave, the way concurrent HTTP
        // requests sharing one Node process actually do.
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
        return getTenantContext().organizationId;
      });
    }

    const [orgA, orgB] = await Promise.all([simulateRequest('org-A'), simulateRequest('org-B')]);

    expect(orgA).toBe('org-A');
    expect(orgB).toBe('org-B');
  });

  it('supports nested contexts without corrupting the outer one', () => {
    runWithTenantContext({ organizationId: 'outer' }, () => {
      expect(getTenantContext().organizationId).toBe('outer');

      runWithTenantContext({ organizationId: 'inner' }, () => {
        expect(getTenantContext().organizationId).toBe('inner');
      });

      expect(getTenantContext().organizationId).toBe('outer');
    });
  });
});
