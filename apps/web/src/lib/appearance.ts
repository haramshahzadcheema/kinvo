import type { Settings } from '@kinvo/contracts';

// The exact same localStorage key index.html's inline bootstrap script
// reads before React ever mounts (see that script's own comment) — this
// file is the ONLY place on the React side allowed to write it, so the
// two can never drift into reading/writing different shapes.
const STORAGE_KEY = 'kinvo:appearance';

export type AppearanceSlice = Pick<
  Settings,
  'theme' | 'accent' | 'fontFamily' | 'fontSize' | 'density' | 'reducedMotion'
>;

// Only the fields that actually change something in the DOM — deliberately
// excludes yellowZoneEscalationNotifications/notificationSound, which have
// no visual/document-level effect and so never need a `data-*` attribute.
export function pickAppearance(settings: Settings): AppearanceSlice {
  const { theme, accent, fontFamily, fontSize, density, reducedMotion } = settings;
  return { theme, accent, fontFamily, fontSize, density, reducedMotion };
}

/**
 * Sets `data-*` attributes on <html> — the single mechanism index.css's
 * entire token system keys off (see that file's [data-theme]/[data-accent]/
 * etc. blocks). Called from three places, all converging on the same
 * document state: index.html's inline bootstrap script (before React
 * exists at all), this module's own applyAndCacheAppearance (once real
 * settings are fetched or optimistically changed), and nowhere else —
 * there is exactly one function in the whole app that touches these
 * attributes, so "what does the DOM currently say" can never drift from
 * "what does this function think it set."
 */
export function applyAppearanceToDocument(appearance: AppearanceSlice): void {
  const root = document.documentElement;
  const resolvedTheme =
    appearance.theme === 'SYSTEM'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'DARK'
        : 'LIGHT'
      : appearance.theme;
  root.setAttribute('data-theme', resolvedTheme);
  root.setAttribute('data-accent', appearance.accent);
  root.setAttribute('data-font-family', appearance.fontFamily);
  root.setAttribute('data-font-size', appearance.fontSize);
  root.setAttribute('data-density', appearance.density);
  if (appearance.reducedMotion) {
    root.setAttribute('data-reduced-motion', 'true');
  } else {
    // Deliberately removed, not set to "false" — index.css's own
    // `@media (prefers-reduced-motion: reduce)` rule is what keeps
    // honoring the OS-level preference when the user hasn't explicitly
    // turned this app setting on; there is no "force motion on" state
    // that should override the OS asking for less of it.
    root.removeAttribute('data-reduced-motion');
  }
}

/** Applies to the live DOM immediately AND writes the cache the next page
 * load's bootstrap script will read — the two steps that together make an
 * appearance change both instant (this session) and FOUC-free (next
 * session). */
export function applyAndCacheAppearance(appearance: AppearanceSlice): void {
  applyAppearanceToDocument(appearance);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Same "never block on a cosmetic preference" reasoning as the
    // bootstrap script's own try/catch — a full/disabled localStorage
    // still leaves the DOM correctly updated for this session.
  }
}

export function readCachedAppearance(): AppearanceSlice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AppearanceSlice) : null;
  } catch {
    return null;
  }
}

export function clearCachedAppearance(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage was never writable to begin with.
  }
}
