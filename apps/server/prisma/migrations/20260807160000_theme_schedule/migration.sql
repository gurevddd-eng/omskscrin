-- Theme schedule for kiosk fleet
ALTER TABLE "SiteSettings" ADD COLUMN "themeMode" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "SiteSettings" ADD COLUMN "themeDarkFrom" TEXT NOT NULL DEFAULT '20:00';
ALTER TABLE "SiteSettings" ADD COLUMN "themeDarkTo" TEXT NOT NULL DEFAULT '08:00';

-- Reported agent software build (OTA visibility)
ALTER TABLE "Kiosk" ADD COLUMN "softwareVersion" TEXT;
