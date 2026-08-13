import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet, getAccessToken, setAccessToken, setOnSessionExpired } from './apiClient';

// Deliberately does NOT mock ./sessionRefresh — refreshSession's own
// single-flight coordination (see sessionRefresh.ts) is exactly what test
// 4 below needs to be real, not stubbed away, to prove N simultaneous 401s
// share one refresh call. Only `fetch` is mocked; everything above it
// (apiClient's retry logic, sessionRefresh's in-flight promise) runs for
// real against that mock.

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    json: async () => body,
  } as Response;
}

const fakeAuthResponse = {
  accessToken: 'fresh-token',
  user: { id: 'u1', email: 'd@example.com', firstName: 'Dee', lastName: 'Ispatcher' },
  organization: { id: 'org1', name: 'Org', slug: 'org' },
  membership: { id: 'm1', role: 'DISPATCHER' as const },
};

describe('apiClient — 401 refresh-and-retry', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
    setOnSessionExpired(null);
  });

  it('returns the response body normally on a successful request', async () => {
    setAccessToken('a-token');
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { hello: 'world' }));

    const result = await apiGet<{ hello: string }>('/api/v1/ships');

    expect(result).toEqual({ hello: 'world' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('on a 401, silently refreshes and retries the ORIGINAL request exactly once, succeeding with the new token', async () => {
    setAccessToken('expired-token');
    let dataCalls = 0;
    vi.mocked(fetch).mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes('/api/v1/auth/refresh')) {
        return jsonResponse(200, fakeAuthResponse);
      }
      dataCalls += 1;
      if (dataCalls === 1) {
        return jsonResponse(401, { error: { message: 'Access token expired.' } });
      }
      return jsonResponse(200, { items: ['ok'] });
    });

    const result = await apiGet<{ items: string[] }>('/api/v1/ships');

    expect(result).toEqual({ items: ['ok'] });
    expect(getAccessToken()).toBe('fresh-token');
    // original (401) + refresh + retry — never more than one retry.
    expect(fetch).toHaveBeenCalledTimes(3);
    // The retried request must actually carry the NEW token, not the
    // stale one the first attempt failed with.
    const retryCall = vi.mocked(fetch).mock.calls[2]!;
    const retryHeaders = retryCall[1]?.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer fresh-token');
  });

  it('never attempts a refresh for a 401 with no access token set (e.g. a failed login)', async () => {
    setAccessToken(null);
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(401, { error: { message: 'Invalid email or password.' } }),
    );

    await expect(apiGet('/api/v1/auth/me')).rejects.toMatchObject({
      status: 401,
      message: 'Invalid email or password.',
    });
    // No refresh attempt — only the one original call.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('when refresh itself fails, clears auth state, notifies onSessionExpired, and surfaces the ORIGINAL 401 — with no retry loop', async () => {
    setAccessToken('expired-token');
    const onSessionExpired = vi.fn();
    setOnSessionExpired(onSessionExpired);

    vi.mocked(fetch).mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes('/api/v1/auth/refresh')) {
        return jsonResponse(401, { error: { message: 'Refresh token is expired or revoked.' } });
      }
      return jsonResponse(401, { error: { message: 'Access token expired.' } });
    });

    await expect(apiGet('/api/v1/ships')).rejects.toMatchObject({
      status: 401,
      message: 'Access token expired.',
    });

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    // Exactly the original request + the one refresh attempt — a failed
    // refresh must never retry itself or the original request again.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares a single refresh operation across multiple simultaneous 401s, not one refresh per request', async () => {
    setAccessToken('expired-token');
    let dataCalls = 0;
    let refreshCalls = 0;
    vi.mocked(fetch).mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes('/api/v1/auth/refresh')) {
        refreshCalls += 1;
        return jsonResponse(200, fakeAuthResponse);
      }
      dataCalls += 1;
      // The first two data calls are the two concurrent requests' initial
      // (expired-token) attempts; anything after that is a post-refresh
      // retry, which should now succeed.
      if (dataCalls <= 2) {
        return jsonResponse(401, { error: { message: 'Access token expired.' } });
      }
      return jsonResponse(200, { ok: true });
    });

    const [a, b] = await Promise.all([
      apiGet<{ ok: boolean }>('/api/v1/ships'),
      apiGet<{ ok: boolean }>('/api/v1/drivers'),
    ]);

    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(refreshCalls).toBe(1);
    expect(getAccessToken()).toBe('fresh-token');
  });
});
