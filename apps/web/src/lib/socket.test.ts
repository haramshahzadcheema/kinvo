import { io } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from './apiClient';
import { connectSocket, disconnectSocket } from './socket';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));

function fakeSocketInstance() {
  return { connected: false, on: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
}

// The core of the Phase 5 hardening pass's P0 fix: connectSocket() used to
// pass `auth: { token }` as a static object captured once at connection
// time, so an automatic reconnect after the token expired (JWT_ACCESS_TTL
// is 15 minutes; a socket surviving one disconnect/reconnect cycle past
// that is not a contrived scenario for a page meant to stay open a whole
// shift) kept presenting the SAME stale token forever. This test proves
// the fix directly: the `auth` option socket.io-client is given is a
// callback that reads apiClient.ts's CURRENT token, not a frozen value —
// which is exactly what makes every reconnect attempt (socket.io-client
// invokes this callback fresh on each one) see a live token.
describe('connectSocket', () => {
  afterEach(() => {
    disconnectSocket();
    vi.resetAllMocks();
  });

  it('reads the current access token via a callback, not a value frozen at connect time', () => {
    const instance = fakeSocketInstance();
    vi.mocked(io).mockReturnValue(instance as never);

    setAccessToken('token-a');
    connectSocket();

    const [, options] = vi.mocked(io).mock.calls[0]!;
    const authOption = (options as { auth: unknown }).auth;
    expect(typeof authOption).toBe('function');
    const authCallback = authOption as (cb: (data: object) => void) => void;

    const firstAttempt = vi.fn();
    authCallback(firstAttempt);
    expect(firstAttempt).toHaveBeenCalledWith({ token: 'token-a' });

    // Simulate the token being rotated (e.g. by RealtimeProvider's
    // connect_error handler redeeming a fresh one) between the initial
    // connection and a later automatic reconnect attempt. socket.io-client
    // re-invokes this exact same auth option on every attempt — the bug
    // this fix addresses is that it used to always see 'token-a' again.
    setAccessToken('token-b');
    const secondAttempt = vi.fn();
    authCallback(secondAttempt);
    expect(secondAttempt).toHaveBeenCalledWith({ token: 'token-b' });
  });

  it('disconnects any prior socket before establishing a new one', () => {
    const first = fakeSocketInstance();
    const second = fakeSocketInstance();
    vi.mocked(io).mockReturnValueOnce(first as never).mockReturnValueOnce(second as never);

    setAccessToken('token-a');
    connectSocket();
    connectSocket();

    expect(first.disconnect).toHaveBeenCalledTimes(1);
  });
});
