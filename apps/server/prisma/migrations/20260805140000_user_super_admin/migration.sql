-- AlterTable
ALTER TABLE "User" ADD COLUMN "superAdmin" BOOLEAN NOT NULL DEFAULT false;

-- First admin account becomes super admin (typically seeded login)
UPDATE "User"
SET "superAdmin" = true
WHERE "id" = (
  SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1
);
