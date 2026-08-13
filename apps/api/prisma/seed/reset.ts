import { DEMO_EMAIL_DOMAIN } from './data';

// The Prisma Client Extension in core/prisma.ts changes the client's shape
// just enough that the plain `PrismaClient` type from `@prisma/client`
// doesn't structurally match it — deriving the type from the actual
// exported client (via a type-only import expression, no runtime import
// needed) is the same convention core/prisma.ts's own `TransactionClient`
// type uses.
type PrismaClient = typeof import('../../src/core/prisma').prisma;

/**
 * Deletes exactly the demo dataset — everything scoped to `organizationIds`,
 * plus the demo Organization rows themselves and any User whose email lives
 * under the reserved `@kinvo-demo.test` domain. Nothing else in the
 * database is touched: no TRUNCATE, no wildcard deletes, no reliance on
 * Organization's own cascade (several FKs off Assignment — truckRequirement,
 * driver — are deliberately `onDelete: Restrict` in production, to stop a
 * real org's history from being silently wiped out from under it; a single
 * cascading `DELETE FROM organizations` is not guaranteed to resolve those
 * paths in the right order). This instead deletes leaf tables first, in
 * explicit dependency order, exactly the order the schema's own FK graph
 * requires.
 *
 * Safe to call when nothing matches (fresh database, first run) — every
 * statement is a no-op if its WHERE clause matches zero rows.
 */
export async function deleteDemoData(prisma: PrismaClient, organizationIds: string[]): Promise<void> {
  if (organizationIds.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM voice_webhook_events
      WHERE "attemptId" IN (
        SELECT aa.id FROM assignment_attempts aa
        JOIN assignments a ON a.id = aa."assignmentId"
        WHERE a."organizationId" = ANY(${organizationIds})
      )
    `;
    await tx.$executeRaw`
      DELETE FROM voice_call_placements
      WHERE "assignmentId" IN (
        SELECT id FROM assignments WHERE "organizationId" = ANY(${organizationIds})
      )
    `;
    await tx.$executeRaw`DELETE FROM yellow_zone_items WHERE "organizationId" = ANY(${organizationIds})`;
    await tx.$executeRaw`DELETE FROM notifications WHERE "organizationId" = ANY(${organizationIds})`;
    await tx.$executeRaw`
      DELETE FROM assignment_attempts
      WHERE "assignmentId" IN (
        SELECT id FROM assignments WHERE "organizationId" = ANY(${organizationIds})
      )
    `;
    await tx.$executeRaw`DELETE FROM reminder_campaigns WHERE "organizationId" = ANY(${organizationIds})`;
    await tx.$executeRaw`DELETE FROM assignments WHERE "organizationId" = ANY(${organizationIds})`;
    await tx.$executeRaw`
      DELETE FROM document_requirements
      WHERE "shipId" IN (SELECT id FROM ships WHERE "organizationId" = ANY(${organizationIds}))
    `;
    await tx.$executeRaw`
      DELETE FROM truck_requirements
      WHERE "shipId" IN (SELECT id FROM ships WHERE "organizationId" = ANY(${organizationIds}))
    `;
    await tx.$executeRaw`DELETE FROM ships WHERE "organizationId" = ANY(${organizationIds})`;
    // Assignment rows are gone (deleted above), so Driver's onDelete:
    // Restrict via Assignment can no longer block this.
    await tx.$executeRaw`DELETE FROM drivers WHERE "organizationId" = ANY(${organizationIds})`;
    await tx.$executeRaw`DELETE FROM audit_log_entries WHERE "organizationId" = ANY(${organizationIds})`;
    await tx.$executeRaw`DELETE FROM invitations WHERE "organizationId" = ANY(${organizationIds})`;
    await tx.$executeRaw`DELETE FROM memberships WHERE "organizationId" = ANY(${organizationIds})`;
    // Users are platform identities, not org-owned rows, so they're
    // identified by the reserved demo email domain rather than by
    // organizationId. Cascades refresh_tokens/user_preferences
    // automatically (both onDelete: Cascade on User). createdByUserId FKs
    // on Assignment/ReminderCampaign have no onDelete override (defaults to
    // restrict-like behavior) but those rows are already gone by this point.
    await tx.$executeRaw`DELETE FROM users WHERE email LIKE ${'%@' + DEMO_EMAIL_DOMAIN}`;
    await tx.$executeRaw`DELETE FROM organizations WHERE id = ANY(${organizationIds})`;
  });
}

/** Finds every organization created by a previous demo seed run, by name. */
export async function findExistingDemoOrgs(
  prisma: PrismaClient,
  orgNames: string[],
): Promise<{ id: string; name: string }[]> {
  return prisma.organization.findMany({
    where: { name: { in: orgNames } },
    select: { id: true, name: true },
  });
}
