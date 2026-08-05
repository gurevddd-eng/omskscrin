-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "deployUser" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "deployPassword" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "domainSuffix" TEXT NOT NULL DEFAULT 'udhb.local';
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "deployTransport" TEXT;
