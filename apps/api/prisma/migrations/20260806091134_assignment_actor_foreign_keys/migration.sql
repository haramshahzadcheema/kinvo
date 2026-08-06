-- These two columns already existed as plain strings with no referential
-- integrity — every other "who did this" reference in this schema
-- (Invitation.invitedById, Membership.userId, RefreshToken.userId) has a
-- real FK to User; these two were the exception. Verified against both
-- the dev and test databases before writing this migration that no
-- existing row's value fails to match a real user (zero orphans), so this
-- is a plain additive constraint — no backfill needed.

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_attempts" ADD CONSTRAINT "assignment_attempts_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
