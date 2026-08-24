-- One game per exhibit (metadata only) + UNC share index from kiosks
ALTER TABLE "Exhibit" ADD COLUMN "gameTitle" TEXT NOT NULL DEFAULT 'Играть';
ALTER TABLE "Exhibit" ADD COLUMN "gameShareFolder" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Exhibit" ADD COLUMN "gameExe" TEXT NOT NULL DEFAULT '';

ALTER TABLE "SiteSettings" ADD COLUMN "gameShareUnc" TEXT NOT NULL DEFAULT '\\HYDRALISK3\Patriot\Игры парк победы';
ALTER TABLE "SiteSettings" ADD COLUMN "gameShareFolders" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "SiteSettings" ADD COLUMN "gameShareScannedAt" TIMESTAMP(3);
ALTER TABLE "SiteSettings" ADD COLUMN "gameShareSource" TEXT;
