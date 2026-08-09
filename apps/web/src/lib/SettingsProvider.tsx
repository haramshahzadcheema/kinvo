import { useEffect, type ReactNode } from 'react';
import { useSettings } from '../features/settings/useSettings';
import { applyAndCacheAppearance, pickAppearance } from './appearance';
import { useAuth } from './useAuth';

/**
 * Owns the "keep the DOM in sync with this user's real, backend-persisted
 * appearance" side effect — mounted once, alongside RealtimeProvider,
 * inside AuthProvider. Has no visual output and no context value of its
 * own; components that need the current settings call useSettings()
 * directly (same pattern as useUnreadCount()/useYellowZoneStatusCounts()
 * — a shared TanStack Query cache entry, not prop drilling through a
 * context).
 *
 * index.html's inline bootstrap script already applies a cached, possibly
 * stale copy of these same attributes before React even mounts (see that
 * script's comment) — this effect's job is narrower: once the REAL
 * settings arrive from the backend, reconcile the DOM (and the cache the
 * bootstrap script reads next time) with them, covering the two cases the
 * bootstrap script can't: a first-ever login on this device (no cache yet)
 * and a preference changed from a different device/tab since the cache
 * was last written.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { data: settings } = useSettings({ enabled: status === 'authenticated' });

  useEffect(() => {
    if (!settings) return;
    applyAndCacheAppearance(pickAppearance(settings));
  }, [settings]);

  return <>{children}</>;
}
