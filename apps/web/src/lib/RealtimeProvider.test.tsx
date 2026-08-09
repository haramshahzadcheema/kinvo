import type { AuthResponse } from '@kinvo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, setAccessToken } from './apiClient';
import { AuthContext, type AuthContextValue } from './AuthContext';
import { RealtimeProvider } from './RealtimeProvider';
import { refreshSession } from './sessionRefresh';
import { connectSocket, disconnectSocket } from './socket';

vi.mock('./socket', () => ({ connectSocket: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('./sessionRefresh', () => ({ refreshSession: vi.fn() }));

const authedContext: AuthContextValue = {
  status: 'authenticated',
  auth: null,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
};

const fakeAuthResponse: AuthResponse = {
  accessToken: 'fresh-token',
  user: { id: 'u1', email: 'd@example.com', firstName: 'Dee', lastName: 'Ispatcher' },
  organization: { id: 'org1', name: 'Org', slug: 'org' },
  membership: { id: 'm1', role: 'DISPATCHER' },
};

function fakeSocket() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { connected: true, connect: vi.fn(), disconnect: vi.fn() });
}

function renderProvider(context: AuthContextValue = authedContext) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={context}>
        <RealtimeProvider>
          <div>child</div>
        </RealtimeProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return {
    ...utils,
    queryClient,
    rerenderWithContext: (next: AuthContextValue) =>
      utils.rerender(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={next}>
            <RealtimeProvider>
              <div>child</div>
            </RealtimeProvider>
          </AuthContext.Provider>
        </QueryClientProvider>,
      ),
  };
}

// The other half of the P0 fix (see socket.test.ts for the live-token-read
// half): what happens when even the CURRENT token has gone stale by the
// time a reconnect is attempted. This is the scenario the original bug
// report described — a socket that outlives its token's 15-minute TTL,
// then hits a transient disconnect (server restart, deploy, network blip)
// — and it used to leave the UI stuck on "Reconnecting…" forever with no
// recovery path.
describe('RealtimeProvider — reconnect-with-stale-token recovery', () => {
  afterEach(() => {
    vi.resetAllMocks();
    setAccessToken(null);
  });

  it('redeems a fresh token via the app-wide refresh flow and retries the connection on connect_error', async () => {
    setAccessToken('stale-token');
    const socket = fakeSocket();
    vi.mocked(connectSocket).mockReturnValue(socket as never);
    vi.mocked(refreshSession).mockResolvedValue(fakeAuthResponse);

    renderProvider();
    socket.emit('connect_error', new Error('Invalid or expired access token.'));

    await waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
    // The SAME store connectSocket's own live-reading auth callback reads
    // from (see socket.test.ts) — proving the two halves of the fix are
    // actually wired to each other, not just independently correct.
    expect(getAccessToken()).toBe('fresh-token');
  });

  it('does nothing further when the refresh itself fails — no session left to recover, no second auth system invented', async () => {
    setAccessToken('stale-token');
    const socket = fakeSocket();
    vi.mocked(connectSocket).mockReturnValue(socket as never);
    vi.mocked(refreshSession).mockRejectedValue(new Error('Missing refresh token.'));

    renderProvider();
    socket.emit('connect_error', new Error('Invalid or expired access token.'));

    await waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    // socket.io's own reconnection backoff is left in control — this
    // handler must not itself force a retry against a session it just
    // proved doesn't exist.
    expect(socket.connect).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('stale-token');
  });

  it('does not stack a second refresh attempt while one is already in flight', async () => {
    setAccessToken('stale-token');
    const socket = fakeSocket();
    vi.mocked(connectSocket).mockReturnValue(socket as never);
    let resolveRefresh!: (value: AuthResponse) => void;
    vi.mocked(refreshSession).mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    renderProvider();
    socket.emit('connect_error', new Error('x'));
    socket.emit('connect_error', new Error('x'));

    expect(refreshSession).toHaveBeenCalledTimes(1);
    resolveRefresh(fakeAuthResponse);
    await waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
  });

  it('disconnects the socket when status transitions away from authenticated (logout)', () => {
    setAccessToken('a-token');
    const socket = fakeSocket();
    vi.mocked(connectSocket).mockReturnValue(socket as never);
    const { rerenderWithContext } = renderProvider();
    expect(connectSocket).toHaveBeenCalledTimes(1);
    expect(disconnectSocket).not.toHaveBeenCalled();

    rerenderWithContext({ ...authedContext, status: 'unauthenticated' });
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });
});

// Phase 6 audit Finding 2: Socket.io does not replay events emitted while
// disconnected, and the old `handleConnect` did nothing but flip the
// status pill — a reconnect after any gap (server restart, deploy, a
// connect_error cycle) left the UI silently stale with no recovery path
// short of a manual refresh. These tests exercise the actual `connect`
// handler wired into the real socket instance, not a hand-rolled call to
// invalidateQueries from the test itself — that would only prove
// TanStack Query works, not that this file's own wiring calls it.
describe('RealtimeProvider — reconnect catch-up invalidation (Phase 6 audit Finding 2)', () => {
  afterEach(() => {
    vi.resetAllMocks();
    setAccessToken(null);
  });

  it('invalidates both realtime-backed query surfaces on the initial connect', async () => {
    setAccessToken('a-token');
    const socket = fakeSocket();
    vi.mocked(connectSocket).mockReturnValue(socket as never);

    const { queryClient } = renderProvider();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    socket.emit('connect');

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['yellow-zone'] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications'] });
  });

  it('invalidates again on a genuine reconnect after a disconnect, not just the first connect', async () => {
    setAccessToken('a-token');
    const socket = fakeSocket();
    vi.mocked(connectSocket).mockReturnValue(socket as never);

    const { queryClient } = renderProvider();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Simulates exactly the scenario the audit described: connected, then
    // a gap (server restart / deploy / transient drop) during which
    // something could have changed server-side, then socket.io's own
    // reconnection logic re-establishes the connection and fires `connect`
    // again — the same event, not a distinct "reconnect" event, which is
    // exactly why hooking `connect` itself (not just connect_error) is
    // what closes the gap.
    socket.emit('connect');
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(2));
    invalidateSpy.mockClear();

    socket.emit('disconnect');
    socket.emit('connect');

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['yellow-zone'] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications'] });
  });
});

// Phase 6 audit Finding 3: prior tests proved query invalidation causes
// NotificationsPage to update, but nothing proved the socket event itself
// reaches invalidateQueries through this file's own listener wiring. These
// simulate the real event on the real socket instance RealtimeProvider
// subscribes to, the same way the reconnect tests above do — not a direct
// call to invalidateQueries from the test.
describe('RealtimeProvider — notification realtime event wiring (Phase 6 audit Finding 3)', () => {
  afterEach(() => {
    vi.resetAllMocks();
    setAccessToken(null);
  });

  it('invalidates the notifications query when notification.created arrives', async () => {
    setAccessToken('a-token');
    const socket = fakeSocket();
    vi.mocked(connectSocket).mockReturnValue(socket as never);

    const { queryClient } = renderProvider();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    invalidateSpy.mockClear();

    socket.emit('notification.created', { notification: { id: 'n1' } });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications'] }),
    );
  });

  it('invalidates the notifications query when notification.read arrives', async () => {
    setAccessToken('a-token');
    const socket = fakeSocket();
    vi.mocked(connectSocket).mockReturnValue(socket as never);

    const { queryClient } = renderProvider();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    invalidateSpy.mockClear();

    socket.emit('notification.read', {});

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications'] }),
    );
  });

  it('does not invalidate the yellow-zone query for a notification-only event', async () => {
    setAccessToken('a-token');
    const socket = fakeSocket();
    vi.mocked(connectSocket).mockReturnValue(socket as never);

    const { queryClient } = renderProvider();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    invalidateSpy.mockClear();

    socket.emit('notification.created', { notification: { id: 'n1' } });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications'] }),
    );
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['yellow-zone'] });
  });
});

// Yellow Zone's own event wiring had the identical gap (no test simulated
// a real socket event, only a direct invalidateQueries call from within
// YellowZonePage's own test) — covered here for the same reason Finding 3
// covers notifications, using the exact same real-socket-emit pattern.
describe('RealtimeProvider — yellow zone realtime event wiring', () => {
  afterEach(() => {
    vi.resetAllMocks();
    setAccessToken(null);
  });

  it('invalidates the yellow-zone query when yellow_zone.created arrives', async () => {
    setAccessToken('a-token');
    const socket = fakeSocket();
    vi.mocked(connectSocket).mockReturnValue(socket as never);

    const { queryClient } = renderProvider();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    invalidateSpy.mockClear();

    socket.emit('yellow_zone.created', { item: { id: 'yz1' } });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['yellow-zone'] }),
    );
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['notifications'] });
  });
});
