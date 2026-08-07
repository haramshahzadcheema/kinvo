-- CreateTable
CREATE TABLE "audit_log_entries" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "organizationId" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_entries_organizationId_createdAt_idx" ON "audit_log_entries"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_entries_organizationId_targetId_idx" ON "audit_log_entries"("organizationId", "targetId");
