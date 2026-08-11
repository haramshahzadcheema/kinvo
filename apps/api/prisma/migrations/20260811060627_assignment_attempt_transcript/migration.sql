-- AlterTable
ALTER TABLE "assignment_attempts" ADD COLUMN     "transcriptSummary" TEXT,
ADD COLUMN     "transcriptTurns" JSONB;
