import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { getAccessToken, setAccessToken } from './apiClient';
import { RealtimeContext, type RealtimeConnectionStatus } from './RealtimeContext';
import { refreshSession } from './sessionRefresh';
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

// Phase 6: same "invalidate, never trust the payload" principle. Delivered
// to this user's own socket room (user:${userId}), not the organization
// room — see socketServer.ts/emitter.ts for the room-targeting change.
const NOTIFICATION_EVENTS = ['notification.created', 'notification.read'] as const;

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

    if (!getAccessToken()) {
      // Shouldn't happen (status only becomes 'authenticated' after the
      // token is set — see auth.tsx) but fail safe rather than connect
      // with nothing.
      return;
    }

    const socket = connectSocket();
    setConnectionStatus(socket.connected ? 'connected' : 'connecting');

    const handleConnect = () => setConnectionStatus('connected');
    const handleDisconnect = () => setConnectionStatus('connecting');

    // The other half of the reconnect-with-a-stale-token fix (see
    // socket.ts's connectSocket doc comment). socket.io-client already
    // re-reads apiClient.ts's CURRENT token on every reconnect attempt via
    // the callback-form `auth` option — this handler covers the case where
    // even the current token has expired: it reuses the exact same
    // silent-refresh flow AuthProvider's own mount effect uses (not a
    // second auth implementation), and on success writes the new token
    // into the same store `connectSocket`'s callback reads from, then
    // nudges socket.io to retry immediately rather than waiting out its
    // own backoff — the cause is already fixed, no reason to wait.
    //
    // If the refresh itself fails (the refresh-token cookie is genuinely
    // dead, not just the access token), this intentionally does nothing
    // further: there is no session left to recover into, and inventing a
    // second recovery path beyond "reuse the app's one refresh mechanism"
    // would be exactly the kind of parallel auth system this fix is meant
    // to avoid. socket.io's own reconnection backoff keeps retrying on its
    // normal schedule regardless — each subsequent attempt triggers this
    // same handler again, so a transient outage (server restart, deploy)
    // self-heals the moment the server (and therefore the refresh
    // endpoint) is reachable again, with no user action required.
    let refreshingOnDisconnect = false;
    const handleConnectError = () => {
      setConnectionStatus('connecting');
      if (refreshingOnDisconnect) return;
      refreshingOnDisconnect = true;
      refreshSession()
        .then((response) => {
          setAccessToken(response.accessToken);
          socket.connect();
        })
        .catch(() => {
          // No valid session to recover — leave socket.io's own backoff to
          // keep trying; see doc comment above.
        })
        .finally(() => {
          refreshingOnDisconnect = false;
        });
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    const handleYellowZoneEvent = () => {
      void queryClient.invalidateQueries({ queryKey: ['yellow-zone'] });
    };
    for (const event of YELLOW_ZONE_EVENTS) {
      socket.on(event, handleYellowZoneEvent);
    }

    const handleNotificationEvent = () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };
    for (const event of NOTIFICATION_EVENTS) {
      socket.on(event, handleNotificationEvent);
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      for (const event of YELLOW_ZONE_EVENTS) {
        socket.off(event, handleYellowZoneEvent);
      }
      for (const event of NOTIFICATION_EVENTS) {
        socket.off(event, handleNotificationEvent);
      }
    };
  }, [status, queryClient]);

  return <RealtimeContext.Provider value={connectionStatus}>{children}</RealtimeContext.Provider>;
}
