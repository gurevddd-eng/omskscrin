-- AlterEnum
CREATE TYPE "ProbeStatus" AS ENUM ('unknown', 'healthy', 'degraded', 'no_software', 'unreachable');

-- AlterTable
ALTER TABLE "Kiosk" ADD COLUMN "hostname" TEXT;
ALTER TABLE "Kiosk" ADD COLUMN "healthPort" INTEGER NOT NULL DEFAULT 47821;
ALTER TABLE "Kiosk" ADD COLUMN "probeStatus" "ProbeStatus" NOT NULL DEFAULT 'unknown';
ALTER TABLE "Kiosk" ADD COLUMN "probeMessage" TEXT;
ALTER TABLE "Kiosk" ADD COLUMN "lastProbeAt" TIMESTAMP(3);

-- Backfill hostname from kioskId for existing rows
UPDATE "Kiosk" SET "hostname" = "kioskId" WHERE "hostname" IS NULL;

ALTER TABLE "Kiosk" ALTER COLUMN "hostname" SET NOT NULL;

CREATE UNIQUE INDEX "Kiosk_hostname_key" ON "Kiosk"("hostname");
