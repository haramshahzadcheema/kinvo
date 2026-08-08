import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { getAccessToken } from './apiClient';
import { RealtimeContext, type RealtimeConnectionStatus } from './RealtimeContext';
import { connectSocket, disconnectSocket } from './socket';
import { useAuth } from './useAuth';

// Every Yellow Zone event this app currently emits invalidates the exact
// same query — a socket event is a "go refetch" signal, never a payload
// the UI trusts directly (see docs/ARCHITECTURE.md's Phase 5 realtime
// section), so there is no reason to special-case which event fired.
const YELLOW_ZONE_EVENTS = [
  'yellow_zone.created',
  'yellow_zone.updated',
  'yellow_zone.resolved',
  'yellow_zone.dismissed',
] as const;

/**
 * Owns the one realtime connection for the whole app — mounted once,
 * inside AuthProvider (needs `status`/session lifecycle) and under
 * QueryClientProvider (needs the query client to invalidate into).
 * Connects/reconnects whenever a fresh access token becomes available
 * (mount-time silent refresh, login, register) and disconnects on logout,
 * mirroring exactly the same lifecycle apiClient.ts's own access-token
 * store already follows.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>('connecting');

  useEffect(() => {
    if (status !== 'authenticated') {
      disconnectSocket();
      setConnectionStatus('connecting');
      return;
    }

    const token = getAccessToken();
    if (!token) {
      // Shouldn't happen (status only becomes 'authenticated' after the
      // token is set — see auth.tsx) but fail safe rather than connect
      // with nothing.
      return;
    }

    const socket = connectSocket(token);
    setConnectionStatus(socket.connected ? 'connected' : 'connecting');

    const handleConnect = () => setConnectionStatus('connected');
    const handleDisconnect = () => setConnectionStatus('connecting');

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleDisconnect);

    const handleYellowZoneEvent = () => {
      void queryClient.invalidateQueries({ queryKey: ['yellow-zone'] });
    };
    for (const event of YELLOW_ZONE_EVENTS) {
      socket.on(event, handleYellowZoneEvent);
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleDisconnect);
      for (const event of YELLOW_ZONE_EVENTS) {
        socket.off(event, handleYellowZoneEvent);
      }
    };
  }, [status, queryClient]);

  return <RealtimeContext.Provider value={connectionStatus}>{children}</RealtimeContext.Provider>;
}
