-- Shared timeline year pages for all kiosks
CREATE TABLE "TimelinePage" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelinePage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TimelinePageImage" (
    "pageId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TimelinePageImage_pkey" PRIMARY KEY ("pageId","fileId")
);

ALTER TABLE "SiteSettings" ADD COLUMN "timelineVersion" TEXT NOT NULL DEFAULT '1';

ALTER TABLE "TimelinePageImage" ADD CONSTRAINT "TimelinePageImage_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "TimelinePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimelinePageImage" ADD CONSTRAINT "TimelinePageImage_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "MediaFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "TimelinePage" ("id", "label", "sortOrder", "createdAt", "updatedAt") VALUES
  ('timeline-1941', '1941', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('timeline-1942', '1942', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('timeline-1943', '1943', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('timeline-1944', '1944', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('timeline-1945', '1945', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
