import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// @testing-library/react's own auto-cleanup hook only self-registers when
// it can see a global `afterEach` (Jest's default, or Vitest with
// `test.globals: true` in vite.config.ts — neither is the case here, since
// every test file imports `afterEach` explicitly from 'vitest' instead).
// Without this, a rendered tree from one test stays mounted into the next
// test in the same file — invisible for tests asserting on non-overlapping
// text (as App.test.tsx's two tests happen to), but surfaces as spurious
// "Found multiple elements" failures the moment two tests in a file render
// overlapping content.
afterEach(cleanup);

// jsdom doesn't implement window.matchMedia at all (not "returns a default,"
// genuinely throws "not a function") — every real browser has it, so this
// isn't papering over a bug, it's supplying what jsdom itself is missing.
// Settings' theme='SYSTEM' resolution (lib/appearance.ts) and the
// prefers-reduced-motion media query in index.css both depend on it being
// callable. `matches: false` is the least surprising default (SYSTEM
// resolves to LIGHT, motion isn't forced-reduced) — a test that cares about
// the OS-dark-mode branch overrides this per-test with vi.stubGlobal.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
