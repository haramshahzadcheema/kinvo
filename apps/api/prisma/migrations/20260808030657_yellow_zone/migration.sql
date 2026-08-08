-- CreateEnum
CREATE TYPE "YellowZoneStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "YellowZonePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "yellow_zone_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignmentAttemptId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "shipId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" "YellowZonePriority" NOT NULL,
    "status" "YellowZoneStatus" NOT NULL DEFAULT 'PENDING',
    "assignedToUserId" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "yellow_zone_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "yellow_zone_items_assignmentAttemptId_key" ON "yellow_zone_items"("assignmentAttemptId");

-- CreateIndex
CREATE INDEX "yellow_zone_items_organizationId_status_idx" ON "yellow_zone_items"("organizationId", "status");

-- CreateIndex
CREATE INDEX "yellow_zone_items_organizationId_priority_idx" ON "yellow_zone_items"("organizationId", "priority");

-- AddForeignKey
ALTER TABLE "yellow_zone_items" ADD CONSTRAINT "yellow_zone_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yellow_zone_items" ADD CONSTRAINT "yellow_zone_items_assignmentAttemptId_fkey" FOREIGN KEY ("assignmentAttemptId") REFERENCES "assignment_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yellow_zone_items" ADD CONSTRAINT "yellow_zone_items_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
