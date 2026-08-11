-- CreateEnum
CREATE TYPE "ReminderCampaignStatus" AS ENUM ('PENDING_APPROVAL', 'SENT', 'CANCELLED');

-- CreateTable
CREATE TABLE "reminder_campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipId" TEXT NOT NULL,
    "status" "ReminderCampaignStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "confirmedDriverCountAtApproval" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminder_campaigns_organizationId_status_idx" ON "reminder_campaigns"("organizationId", "status");

-- CreateIndex
CREATE INDEX "reminder_campaigns_shipId_idx" ON "reminder_campaigns"("shipId");

-- AddForeignKey
ALTER TABLE "reminder_campaigns" ADD CONSTRAINT "reminder_campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_campaigns" ADD CONSTRAINT "reminder_campaigns_shipId_fkey" FOREIGN KEY ("shipId") REFERENCES "ships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_campaigns" ADD CONSTRAINT "reminder_campaigns_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_campaigns" ADD CONSTRAINT "reminder_campaigns_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
