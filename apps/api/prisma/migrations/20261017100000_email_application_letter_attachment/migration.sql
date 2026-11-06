-- AlterTable
ALTER TABLE "EmailApplication" ADD COLUMN     "letterBytes" INTEGER,
ADD COLUMN     "letterFileName" TEXT,
ADD COLUMN     "letterPreviewSha256" TEXT,
ADD COLUMN     "letterResumeId" TEXT,
ADD COLUMN     "letterSha256" TEXT,
ADD COLUMN     "letterSnapshotUrl" TEXT;

