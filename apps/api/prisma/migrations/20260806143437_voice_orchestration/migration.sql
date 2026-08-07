-- AlterTable
ALTER TABLE "assignment_attempts" ADD COLUMN     "provider" TEXT;

-- CreateTable
CREATE TABLE "voice_webhook_events" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_webhook_events_attemptId_idx" ON "voice_webhook_events"("attemptId");

-- AddForeignKey
ALTER TABLE "voice_webhook_events" ADD CONSTRAINT "voice_webhook_events_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "assignment_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
