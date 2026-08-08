import { io, type Socket } from 'socket.io-client';

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

// A singleton, imperative connection — same shape as apiClient.ts's own
// in-memory access-token store, for the same reason: there is exactly one
// realtime connection for the whole app, owned by RealtimeProvider, never
// a per-component concern. Sockets are a cache-invalidation signal for
// TanStack Query, never a parallel state system — nothing here holds
// application data, only the connection itself.
let socket: Socket | null = null;

export function connectSocket(token: string): Socket {
  if (socket) {
    socket.disconnect();
  }
  socket = io(API_URL, {
    auth: { token },
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
