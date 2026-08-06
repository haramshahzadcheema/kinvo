-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'CANCELLED', 'NO_SHOW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('NO_ANSWER', 'BUSY', 'UNREACHABLE', 'WRONG_NUMBER', 'REJECTED', 'CONFIRMED', 'SYSTEM_ERROR');

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "truckRequirementId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "agreedRate" DECIMAL(10,2),
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "rejectionReason" TEXT,
    "noShowAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_attempts" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "outcome" "AttemptOutcome" NOT NULL,
    "notes" TEXT,
    "externalCallId" TEXT,
    "recordedByUserId" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignments_truckRequirementId_driverId_idx" ON "assignments"("truckRequirementId", "driverId");

-- CreateIndex
CREATE INDEX "assignments_truckRequirementId_status_idx" ON "assignments"("truckRequirementId", "status");

-- CreateIndex
CREATE INDEX "assignments_driverId_status_idx" ON "assignments"("driverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_attempts_externalCallId_key" ON "assignment_attempts"("externalCallId");

-- CreateIndex
CREATE INDEX "assignment_attempts_assignmentId_attemptedAt_idx" ON "assignment_attempts"("assignmentId", "attemptedAt");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_truckRequirementId_fkey" FOREIGN KEY ("truckRequirementId") REFERENCES "truck_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_attempts" ADD CONSTRAINT "assignment_attempts_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
