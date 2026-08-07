-- CreateTable
CREATE TABLE "voice_call_placements" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalCallId" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "voice_call_placements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_call_placements_externalCallId_key" ON "voice_call_placements"("externalCallId");

-- CreateIndex
CREATE INDEX "voice_call_placements_assignmentId_idx" ON "voice_call_placements"("assignmentId");

-- CreateIndex
CREATE INDEX "voice_call_placements_resolvedAt_placedAt_idx" ON "voice_call_placements"("resolvedAt", "placedAt");
