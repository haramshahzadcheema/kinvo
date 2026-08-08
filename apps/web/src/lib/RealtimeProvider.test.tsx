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
