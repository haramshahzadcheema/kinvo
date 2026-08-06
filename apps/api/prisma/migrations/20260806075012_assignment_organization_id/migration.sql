-- Denormalizes organizationId directly onto assignments, so the flat
-- cross-ship "call list" query (status = 'PENDING', no other filter) can
-- reach one organization's rows via a direct index instead of a join back
-- through truck_requirements -> ships for every row in the system.
--
-- Added as nullable, backfilled from the existing FK chain, THEN set
-- NOT NULL — a plain "ADD COLUMN ... NOT NULL" would fail outright against
-- any environment that already has assignment rows (e.g. from manual
-- testing), since Postgres has no value to put in the new column for
-- those rows. Every assignment's organizationId is fully determined by its
-- truckRequirement's ship, so the backfill is exact, not a guess.

-- Step 1: add the column as nullable.
ALTER TABLE "assignments" ADD COLUMN "organizationId" TEXT;

-- Step 2: backfill every existing row from the FK chain it always implied.
UPDATE "assignments" AS a
SET "organizationId" = s."organizationId"
FROM "truck_requirements" AS tr
JOIN "ships" AS s ON s."id" = tr."shipId"
WHERE tr."id" = a."truckRequirementId";

-- Step 3: every row now has a value — safe to enforce NOT NULL.
ALTER TABLE "assignments" ALTER COLUMN "organizationId" SET NOT NULL;

-- Step 4: FK, matching the onDelete: Cascade already used by Ship/Driver's
-- own relation to Organization.
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 5: the index this whole migration exists for.
CREATE INDEX "assignments_organizationId_status_idx" ON "assignments"("organizationId", "status");
