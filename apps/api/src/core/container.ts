import { randomUUID } from 'node:crypto';
import {
  createAssignmentsService,
  type AssignmentsService,
} from '../modules/assignments/assignments.service';
import { createAuthService, type AuthService } from '../modules/auth/auth.service';
import { createDriversService, type DriversService } from '../modules/drivers/drivers.service';
import { createHealthService, type HealthService } from '../modules/health/health.service';
import {
  createOrganizationsService,
  type OrganizationsService,
} from '../modules/organizations/organizations.service';
import { createShipsService, type ShipsService } from '../modules/ships/ships.service';
import { createVoiceService, type VoiceService } from '../modules/voice/voice.service';
import {
  createYellowZoneService,
  type YellowZoneService,
} from '../modules/yellow-zone/yellow-zone.service';
import { createAuditLogger, type AuditLogger } from './audit/audit-logger';
import { logger } from './logger';
import { createRealtimeEmitter, type EmitToOrganization } from './realtime/emitter';
import { checkDatabaseConnection, prisma } from './prisma';
import { checkRedisConnection, redis } from './redis';
import { hashPassword, verifyPassword } from './security/password';
import { createTokenRevocationStore, type TokenRevocationStore } from './security/token-revocation';
import {
  generateInvitationTokenValue,
  generateRefreshTokenValue,
  hashInvitationTokenValue,
  hashRefreshTokenValue,
  refreshTokenExpiryDate,
  signAccessToken,
} from './security/tokens';
import { env, requireCalleApiKey } from '../config/env';
import { createCallEAdapter } from './voice/CallEAdapter';
import { createFakeVoiceProvider } from './voice/FakeVoiceProvider';
import type { VoiceProvider } from './voice/VoiceProvider';

/**
 * The composition root: the one place concrete implementations get wired
 * into the services that depend on them. Adding a new service (Phase 4's
 * CALL-E-backed campaignService, etc.) means constructing it here and
 * adding it to Container — services themselves receive their dependencies
 * as factory arguments, not import singletons directly. That's what makes
 * swapping a real dependency for a fake one (e.g. `FakeVoiceProvider` in
 * tests or a resilient demo) a one-line change here, instead of a
 * module-mocking exercise at every call site that uses it — see
 * auth.service.ts / organizations.service.ts / their tests for the pattern
 * this was designed for.
 */
export interface Container {
  healthService: HealthService;
  authService: AuthService;
  organizationsService: OrganizationsService;
  shipsService: ShipsService;
  driversService: DriversService;
  assignmentsService: AssignmentsService;
  auditLogger: AuditLogger;
  tokenRevocationStore: TokenRevocationStore;
  voiceProvider: VoiceProvider;
  voiceService: VoiceService;
  yellowZoneService: YellowZoneService;
  emitToOrganization: EmitToOrganization;
}

export function createContainer(): Container {
  const healthService = createHealthService({
    checkDatabaseConnection,
    checkRedisConnection,
  });

  const auditLogger = createAuditLogger(logger, prisma);
  const tokenRevocationStore = createTokenRevocationStore(redis);

  const authService = createAuthService({
    prisma,
    hashPassword,
    verifyPassword,
    signAccessToken,
    generateRefreshTokenValue,
    hashRefreshTokenValue,
    refreshTokenExpiryDate,
    hashInvitationTokenValue,
    generateFamilyId: randomUUID,
    auditLogger,
  });

  const organizationsService = createOrganizationsService({
    prisma,
    generateInvitationTokenValue,
    hashInvitationTokenValue,
    auditLogger,
    tokenRevocationStore,
  });

  const shipsService = createShipsService({ prisma, auditLogger });
  const driversService = createDriversService({ prisma, auditLogger });
  const assignmentsService = createAssignmentsService({ prisma, auditLogger });

  // The test environment gets an in-memory FakeVoiceProvider instead of a
  // real CallEAdapter: it has no CALL-E account to call, and constructing a
  // CalleClient with no real key would be a pointless (if harmless) step on
  // every one of hundreds of test runs. Every other environment wires the
  // real adapter — env.ts's schema refine already guarantees CALLE_API_KEY
  // is set by the time this code runs outside of tests.
  const voiceProvider: VoiceProvider =
    env.NODE_ENV === 'test'
      ? createFakeVoiceProvider()
      : createCallEAdapter({ apiKey: requireCalleApiKey(), baseUrl: env.CALLE_BASE_URL });

  // Publish-only — see emitter.ts for why this is deliberately independent
  // of the Socket.io server itself (server.ts constructs that separately,
  // once it has an http.Server to attach to; this container is built
  // before that exists, and worker.ts never has one at all).
  const { emitToOrganization } = createRealtimeEmitter();

  const yellowZoneService = createYellowZoneService({ prisma, auditLogger, emitToOrganization });

  const voiceService = createVoiceService({
    prisma,
    voiceProvider,
    assignmentsService,
    yellowZoneService,
    emitToOrganization,
    logger,
  });

  return {
    healthService,
    authService,
    organizationsService,
    shipsService,
    driversService,
    assignmentsService,
    auditLogger,
    tokenRevocationStore,
    voiceProvider,
    voiceService,
    yellowZoneService,
    emitToOrganization,
  };
}
