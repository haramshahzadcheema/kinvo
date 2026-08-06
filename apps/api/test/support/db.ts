import { prisma } from '../../src/core/prisma';

/** Full truncate before each integration test — simple, robust, and cheap
 * enough at this data volume; no cross-test pollution to reason about. */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "invitations", "refresh_tokens", "memberships", "users", "organizations", "ships", "drivers", "truck_requirements", "document_requirements" RESTART IDENTITY CASCADE',
  );
}
