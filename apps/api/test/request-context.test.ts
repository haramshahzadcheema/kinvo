import { describe, expect, it } from 'vitest';
import {
  getRequestContext,
  runWithRequestContext,
  tryGetRequestContext,
  type RequestContext,
} from '../src/core/request-context';

const contextA: RequestContext = {
  userId: 'user-A',
  organizationId: 'org-A',
  membershipId: 'membership-A',
  role: 'OWNER',
};

const contextB: RequestContext = {
  userId: 'user-B',
  organizationId: 'org-B',
  membershipId: 'membership-B',
  role: 'VIEWER',
};

describe('request-context', () => {
  it('throws when read outside of a request-scoped context', () => {
    expect(() => getRequestContext()).toThrowError(/outside of a request-scoped context/);
  });

  it('returns undefined from tryGetRequestContext outside of a context', () => {
    expect(tryGetRequestContext()).toBeUndefined();
  });

  it('makes the bound context available for the duration of the call', () => {
    const observed = runWithRequestContext(contextA, () => getRequestContext());
    expect(observed).toEqual(contextA);
  });

  it('does not leak context after the bound call returns', () => {
    runWithRequestContext(contextA, () => undefined);
    expect(tryGetRequestContext()).toBeUndefined();
  });

  it('isolates context across concurrent async call graphs — the actual guarantee that matters', async () => {
    // This is the exact scenario the whole primitive exists for: two
    // "requests" for different organizations, interleaved by the event
    // loop, must never see each other's tenant. If this test can be made
    // to fail, tenant isolation is broken.
    async function simulateRequest(context: RequestContext): Promise<RequestContext> {
      return runWithRequestContext(context, async () => {
        // Yield to the event loop mid-flight so the two simulated
        // "requests" genuinely interleave, the way concurrent HTTP
        // requests sharing one Node process actually do.
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
        return getRequestContext();
      });
    }

    const [observedA, observedB] = await Promise.all([
      simulateRequest(contextA),
      simulateRequest(contextB),
    ]);

    expect(observedA).toEqual(contextA);
    expect(observedB).toEqual(contextB);
  });

  it('supports nested contexts without corrupting the outer one', () => {
    runWithRequestContext(contextA, () => {
      expect(getRequestContext()).toEqual(contextA);

      runWithRequestContext(contextB, () => {
        expect(getRequestContext()).toEqual(contextB);
      });

      expect(getRequestContext()).toEqual(contextA);
    });
  });
});
