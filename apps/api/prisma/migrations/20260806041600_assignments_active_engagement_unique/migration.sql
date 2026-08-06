-- A driver may have at most one ACTIVE (PENDING or CONFIRMED) engagement
-- per truck requirement at a time. Prisma's schema DSL cannot express a
-- partial/filtered unique index, so this constraint is hand-authored here
-- rather than declared in schema.prisma (which only carries a plain index
-- on the same columns as a query-shape hint — see the Assignment model's
-- comment). A driver CAN have multiple historical rows against the same
-- requirement (e.g. rejected, then later re-approached and confirmed) —
-- this index only ever blocks a second simultaneously-active one.
CREATE UNIQUE INDEX "assignments_one_active_engagement"
  ON "assignments" ("truckRequirementId", "driverId")
  WHERE "status" IN ('PENDING', 'CONFIRMED');
