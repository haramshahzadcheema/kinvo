-- AddForeignKey
ALTER TABLE "voice_call_placements" ADD CONSTRAINT "voice_call_placements_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
