-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "softwareEnabled" BOOLEAN NOT NULL DEFAULT true;
