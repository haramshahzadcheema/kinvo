import { createContext } from 'react';

// 'connecting' covers both "never connected yet" and "reconnecting after a
// drop" — the UI treats them identically (a subtle "Reconnecting…"
// indicator, never a false impression that realtime is live).
export type RealtimeConnectionStatus = 'connecting' | 'connected';

export const RealtimeContext = createContext<RealtimeConnectionStatus | null>(null);
