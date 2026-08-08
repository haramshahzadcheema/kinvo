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
