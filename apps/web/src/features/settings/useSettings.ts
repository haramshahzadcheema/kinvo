import type { Settings, UpdateSettingsRequest } from '@kinvo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyAndCacheAppearance, pickAppearance } from '../../lib/appearance';
import { settingsApi } from './api';

export const SETTINGS_KEY = ['settings'] as const;

// No refetchInterval — same reasoning as every other Phase 5/6 query in
// this app: settings only change when this user changes them (from this
// tab or another one), and a mutation's own cache update/invalidation is
// the only signal that should ever trigger a refetch. There is no
// realtime settings-changed event — a second open tab converges on its
// own next natural refetch (focus/mount), not live; see
// docs/ARCHITECTURE.md's Settings section for why that gap was accepted
// rather than wiring a sixth realtime event for a personal-preferences
// edge case.
export function useSettings(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => settingsApi.get(),
    // Defaults to true (every page-level consumer wants the normal
    // behavior); SettingsProvider is the one caller that passes `false`
    // pre-authentication, where /api/v1/me/preferences would just 401 —
    // same reasoning as RealtimeProvider gating the socket connection on
    // auth status instead of letting it attempt and fail.
    enabled: options.enabled ?? true,
  });
}

const APPEARANCE_KEYS = ['theme', 'accent', 'fontFamily', 'fontSize', 'density', 'reducedMotion'] as const;

function touchesAppearance(input: UpdateSettingsRequest): boolean {
  return APPEARANCE_KEYS.some((key) => key in input);
}

/**
 * Optimistic for the appearance fields specifically (theme/accent/
 * fontFamily/fontSize/density/reducedMotion) — applied to the DOM and the
 * FOUC-avoidance cache the instant `mutate` is called, before the network
 * round trip even starts, per Settings' own "appearance changes should
 * feel instant" requirement. NOT optimistic in any special way for
 * yellowZoneEscalationNotifications/notificationSound — those have no
 * DOM effect to apply early, so they get the same "reflect in the query
 * cache immediately, reconcile with the server after" treatment every
 * other mutation in this codebase already has; there is no separate
 * "confusing divergence" risk to avoid for a plain boolean toggle.
 *
 * On failure: reverts BOTH the query cache and the DOM/localStorage back
 * to the last confirmed-good settings — never leaves the UI showing a
 * theme/font/etc. the server never actually saved. The caller (see
 * AppearanceSection.tsx) surfaces `mutation.isError` as a real, visible
 * message, not a silent revert.
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateSettingsRequest) => settingsApi.update(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_KEY });
      const previous = queryClient.getQueryData<Settings>(SETTINGS_KEY);
      if (previous) {
        const optimistic: Settings = { ...previous, ...input };
        queryClient.setQueryData<Settings>(SETTINGS_KEY, optimistic);
        if (touchesAppearance(input)) {
          applyAndCacheAppearance(pickAppearance(optimistic));
        }
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData<Settings>(SETTINGS_KEY, context.previous);
        applyAndCacheAppearance(pickAppearance(context.previous));
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}
