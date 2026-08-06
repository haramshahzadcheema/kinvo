-- CreateEnum
CREATE TYPE "ShipStatus" AS ENUM ('DRAFT', 'RECRUITING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DriverAvailability" AS ENUM ('IDLE', 'ON_CALL', 'CONFIRMED', 'ESCALATED');

-- CreateTable
CREATE TABLE "ships" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipName" TEXT NOT NULL,
    "company" TEXT,
    "eta" TIMESTAMP(3),
    "reportingTime" TIMESTAMP(3),
    "berth" TEXT,
    "gate" TEXT,
    "cargoType" TEXT,
    "rate" DECIMAL(10,2),
    "rateCurrency" TEXT,
    "status" "ShipStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "truck_requirements" (
    "id" TEXT NOT NULL,
    "shipId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "truckType" TEXT NOT NULL,
    "quantityNeeded" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "truck_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requirements" (
    "id" TEXT NOT NULL,
    "shipId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "nationalId" TEXT,
    "truckPlate" TEXT,
    "truckType" TEXT,
    "capacity" TEXT,
    "languages" TEXT,
    "preferredRoutes" TEXT,
    "preferredCompanies" TEXT,
    "rating" DECIMAL(2,1),
    "previousJobsCount" INTEGER NOT NULL DEFAULT 0,
    "availability" "DriverAvailability" NOT NULL DEFAULT 'IDLE',
    "currentShipId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ships_organizationId_idx" ON "ships"("organizationId");

-- CreateIndex
CREATE INDEX "ships_organizationId_status_idx" ON "ships"("organizationId", "status");

-- CreateIndex
CREATE INDEX "truck_requirements_shipId_idx" ON "truck_requirements"("shipId");

-- CreateIndex
CREATE INDEX "document_requirements_shipId_idx" ON "document_requirements"("shipId");

-- CreateIndex
CREATE INDEX "drivers_organizationId_idx" ON "drivers"("organizationId");

-- CreateIndex
CREATE INDEX "drivers_organizationId_availability_idx" ON "drivers"("organizationId", "availability");

-- CreateIndex
CREATE INDEX "drivers_currentShipId_idx" ON "drivers"("currentShipId");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_organizationId_phone_key" ON "drivers"("organizationId", "phone");

-- AddForeignKey
ALTER TABLE "ships" ADD CONSTRAINT "ships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_requirements" ADD CONSTRAINT "truck_requirements_shipId_fkey" FOREIGN KEY ("shipId") REFERENCES "ships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_shipId_fkey" FOREIGN KEY ("shipId") REFERENCES "ships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_currentShipId_fkey" FOREIGN KEY ("currentShipId") REFERENCES "ships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
