-- CreateTable
CREATE TABLE "GlobalAd" (
    "fileId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GlobalAd_pkey" PRIMARY KEY ("fileId")
);

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "adsVersion" TEXT NOT NULL DEFAULT '1',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

-- Migrate unique ads from ExhibitAd → GlobalAd
INSERT INTO "GlobalAd" ("fileId", "sortOrder")
SELECT DISTINCT ON ("fileId") "fileId", "sortOrder"
FROM "ExhibitAd"
ORDER BY "fileId", "sortOrder" ASC
ON CONFLICT ("fileId") DO NOTHING;

INSERT INTO "SiteSettings" ("id", "adsVersion", "updatedAt")
VALUES ('default', '1', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- DropTable
DROP TABLE IF EXISTS "ExhibitAd";

-- AddForeignKey
ALTER TABLE "GlobalAd" ADD CONSTRAINT "GlobalAd_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "MediaFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
