-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "Accent" AS ENUM ('OCEAN', 'DEEP_BLUE', 'ELECTRIC_BLUE', 'TEAL', 'SLATE');

-- CreateEnum
CREATE TYPE "FontFamily" AS ENUM ('SYSTEM', 'INTER', 'PLUS_JAKARTA_SANS', 'DM_SANS');

-- CreateEnum
CREATE TYPE "FontSize" AS ENUM ('SMALL', 'DEFAULT', 'LARGE', 'EXTRA_LARGE');

-- CreateEnum
CREATE TYPE "Density" AS ENUM ('COMPACT', 'COMFORTABLE', 'SPACIOUS');

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" "Theme" NOT NULL DEFAULT 'SYSTEM',
    "accent" "Accent" NOT NULL DEFAULT 'OCEAN',
    "fontFamily" "FontFamily" NOT NULL DEFAULT 'SYSTEM',
    "fontSize" "FontSize" NOT NULL DEFAULT 'DEFAULT',
    "density" "Density" NOT NULL DEFAULT 'COMFORTABLE',
    "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
    "yellowZoneEscalationNotifications" BOOLEAN NOT NULL DEFAULT true,
    "notificationSound" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_userId_key" ON "user_preferences"("userId");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
