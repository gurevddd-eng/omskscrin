-- AlterTable
ALTER TABLE "Exhibit" ADD COLUMN "specs" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Exhibit" ADD COLUMN "audioId" TEXT;

-- AddForeignKey
ALTER TABLE "Exhibit" ADD CONSTRAINT "Exhibit_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
