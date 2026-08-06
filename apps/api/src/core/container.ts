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
import { createAuditLogger, type AuditLogger } from './audit/audit-logger';
import { logger } from './logger';
import { checkDatabaseConnection, prisma } from './prisma';
import { checkRedisConnection } from './redis';
import { hashPassword, verifyPassword } from './security/password';
import {
  generateInvitationTokenValue,
  generateRefreshTokenValue,
  hashInvitationTokenValue,
  hashRefreshTokenValue,
  refreshTokenExpiryDate,
  signAccessToken,
} from './security/tokens';

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
}

export function createContainer(): Container {
  const healthService = createHealthService({
    checkDatabaseConnection,
    checkRedisConnection,
  });

  const auditLogger = createAuditLogger(logger);

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
  });

  const shipsService = createShipsService({ prisma, auditLogger });
  const driversService = createDriversService({ prisma, auditLogger });
  const assignmentsService = createAssignmentsService({ prisma, auditLogger });

  return {
    healthService,
    authService,
    organizationsService,
    shipsService,
    driversService,
    assignmentsService,
    auditLogger,
  };
}
