-- CreateEnum
CREATE TYPE "InstallStatus" AS ENUM ('idle', 'queued', 'running', 'ok', 'error');

-- AlterTable
ALTER TABLE "Kiosk" ADD COLUMN "installStatus" "InstallStatus" NOT NULL DEFAULT 'idle';
ALTER TABLE "Kiosk" ADD COLUMN "installMessage" TEXT;
ALTER TABLE "Kiosk" ADD COLUMN "lastInstallAt" TIMESTAMP(3);
