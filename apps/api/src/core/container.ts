import { createHealthService, type HealthService } from '../modules/health/health.service';
import { checkDatabaseConnection } from './database';
import { checkRedisConnection } from './redis';

/**
 * The composition root: the one place concrete implementations get wired
 * into the services that depend on them. Adding a new service (Phase 1's
 * authService, Phase 4's CALL-E-backed campaignService) means constructing
 * it here and adding it to Container — services themselves should receive
 * their dependencies as constructor/factory arguments, not import
 * singletons directly. That's what makes swapping a real dependency for a
 * fake one (e.g. `FakeVoiceProvider` in tests or a resilient demo) a
 * one-line change here, instead of a module-mocking exercise at every call
 * site that uses it.
 */
export interface Container {
  healthService: HealthService;
}

export function createContainer(): Container {
  const healthService = createHealthService({
    checkDatabaseConnection,
    checkRedisConnection,
  });

  return { healthService };
}
