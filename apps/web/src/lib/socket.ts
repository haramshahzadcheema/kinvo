import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './apiClient';

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

// A singleton, imperative connection — same shape as apiClient.ts's own
// in-memory access-token store, for the same reason: there is exactly one
// realtime connection for the whole app, owned by RealtimeProvider, never
// a per-component concern. Sockets are a cache-invalidation signal for
// TanStack Query, never a parallel state system — nothing here holds
// application data, only the connection itself.
let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket) {
    socket.disconnect();
  }
  socket = io(API_URL, {
    // The callback form, not a static `{ token }` object — socket.io
    // invokes this function fresh on the INITIAL connection AND on every
    // automatic reconnect attempt, so a reconnect that happens after the
    // original token has expired (JWT_ACCESS_TTL is 15 minutes; a socket
    // that outlives one disconnect/reconnect cycle past that window is not
    // a contrived scenario for a page meant to stay open a whole shift)
    // presents whatever token is CURRENTLY in apiClient.ts's store, not
    // whatever was current the moment this socket first connected. A
    // static `auth: { token }` object was the original bug here — see
    // RealtimeProvider.tsx's connect_error handler for the other half of
    // the fix (what happens when even the current token has gone stale).
    auth: (cb) => cb({ token: getAccessToken() }),
    transports: ['websocket'],
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function getSocket(): Socket | null {
  return socket;
}
