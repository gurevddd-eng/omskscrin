-- CreateTable
CREATE TABLE "ExhibitAd" (
    "exhibitId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExhibitAd_pkey" PRIMARY KEY ("exhibitId","fileId")
);

-- AddForeignKey
ALTER TABLE "ExhibitAd" ADD CONSTRAINT "ExhibitAd_exhibitId_fkey" FOREIGN KEY ("exhibitId") REFERENCES "Exhibit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExhibitAd" ADD CONSTRAINT "ExhibitAd_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "MediaFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
