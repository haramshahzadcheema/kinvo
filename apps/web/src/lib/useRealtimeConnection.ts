import { useContext } from 'react';
import { RealtimeContext, type RealtimeConnectionStatus } from './RealtimeContext';

export function useRealtimeConnection(): RealtimeConnectionStatus {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error('useRealtimeConnection must be used within a RealtimeProvider.');
  }
  return ctx;
}
