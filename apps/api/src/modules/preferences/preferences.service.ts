import type { Settings, UpdateSettingsRequest } from '@kinvo/contracts';
import { Prisma } from '@prisma/client';
import { getRequestContext } from '../../core/request-context';
import type { prisma as prismaClient } from '../../core/prisma';

export interface PreferencesServiceDependencies {
  prisma: typeof prismaClient;
}

export interface PreferencesService {
  getSettings(): Promise<Settings>;
  updateSettings(input: UpdateSettingsRequest): Promise<Settings>;
}

function toSettingsDto(row: {
  theme: string;
  accent: string;
  fontFamily: string;
  fontSize: string;
  density: string;
  reducedMotion: boolean;
  yellowZoneEscalationNotifications: boolean;
  notificationSound: boolean;
}): Settings {
  return {
    theme: row.theme as Settings['theme'],
    accent: row.accent as Settings['accent'],
    fontFamily: row.fontFamily as Settings['fontFamily'],
    fontSize: row.fontSize as Settings['fontSize'],
    density: row.density as Settings['density'],
    reducedMotion: row.reducedMotion,
    yellowZoneEscalationNotifications: row.yellowZoneEscalationNotifications,
    notificationSound: row.notificationSound,
  };
}

// UserPreferences is deliberately NOT in core/prisma.ts's
// TENANT_SCOPED_MODELS — it has no organizationId column at all (same
// reasoning as TruckRequirement/DocumentRequirement: injecting one would
// be a Prisma validation error, not a usable scope). Isolation here is
// entirely `userId: context.userId`, the only dimension this model has —
// see schema.prisma's UserPreferences comment for why personal appearance
// is keyed on User, never on Organization/Membership.
export function createPreferencesService({
  prisma,
}: PreferencesServiceDependencies): PreferencesService {
  // Every authenticated user has exactly one settings row, created
  // lazily on first read rather than at registration — a brand-new user
  // who never opens Settings should still get a normal 200 with defaults,
  // not a 404 the frontend has to special-case.
  //
  // NOT `upsert`: proven under an actual concurrency test (5 simultaneous
  // first-reads for a brand-new user) that Prisma 5's `upsert` here is
  // not atomic against a real race — two callers can both pass its
  // internal existence check before either write lands, and the loser's
  // `create` then hits `userId`'s unique constraint as an unhandled
  // P2002, a real 500. Explicit create-then-catch-P2002-then-read is the
  // same idiom this codebase already uses everywhere else a unique
  // constraint is the actual concurrency guard (see
  // yellow-zone.service.ts's createEscalationForAttempt and
  // notification.service.ts's createForRecipients) — the constraint does
  // the real work; the catch just turns "someone else already created
  // this" into a normal read instead of an error.
  async function ensureRow(userId: string) {
    try {
      return await prisma.userPreferences.create({ data: { userId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return prisma.userPreferences.findUniqueOrThrow({ where: { userId } });
      }
      throw error;
    }
  }

  async function getSettings(): Promise<Settings> {
    const context = getRequestContext();
    const row = await prisma.userPreferences.findUnique({ where: { userId: context.userId } });
    return toSettingsDto(row ?? (await ensureRow(context.userId)));
  }

  // Concurrency semantics, deliberately: two concurrent PATCH requests
  // for the same user race on two independent UPDATE statements once the
  // row exists (ensureRow above only matters for the very first write for
  // a given user). Disjoint fields (one changes theme, the other density)
  // both land cleanly. Overlapping fields last-write-wins by DB commit
  // order — the same "no optimistic lock" semantics ships/drivers/every
  // other simple field-level edit in this codebase already has, and
  // appropriate here: this is a cosmetic personal preference, not a
  // safety-critical state transition like a Yellow Zone claim, so there
  // is no meaningful "someone else got there first" conflict worth
  // surfacing to the user.
  async function updateSettings(input: UpdateSettingsRequest): Promise<Settings> {
    const context = getRequestContext();
    await ensureRow(context.userId);
    const row = await prisma.userPreferences.update({
      where: { userId: context.userId },
      data: input,
    });
    return toSettingsDto(row);
  }

  return { getSettings, updateSettings };
}
