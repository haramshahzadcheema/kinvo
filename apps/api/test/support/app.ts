import type { Express } from 'express';
import { createApp } from '../../src/app';
import { createContainer } from '../../src/core/container';

export function buildApp(): Express {
  return createApp(createContainer());
}
