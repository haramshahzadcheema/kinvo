import type { Express } from 'express';
import { createApp } from '../../src/app';
import { createContainer, type Container } from '../../src/core/container';

export function buildApp(): Express {
  return buildAppWithContainer().app;
}

/**
 * Same as `buildApp`, but also returns the container it was built from —
 * needed by tests that must reach into a fake dependency the container
 * wires up (e.g. voice.test.ts controlling FakeVoiceProvider's outcomes)
 * rather than only exercising the app through HTTP.
 */
export function buildAppWithContainer(): { app: Express; container: Container } {
  const container = createContainer();
  return { app: createApp(container), container };
}
