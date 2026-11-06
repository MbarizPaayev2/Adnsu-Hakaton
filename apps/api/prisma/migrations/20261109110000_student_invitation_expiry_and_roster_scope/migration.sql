-- AlterEnum
ALTER TYPE "ConsentScope" ADD VALUE 'IDENTIFIABLE_ROSTER';

-- AlterTable
ALTER TABLE "AcademyEnrollment" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- Backfill existing enrollments with 14-day expiry from creation if null
UPDATE "AcademyEnrollment" SET "expiresAt" = "createdAt" + INTERVAL '14 days' WHERE "expiresAt" IS NULL;

-- CreateIndex
CREATE INDEX "AcademyEnrollment_expiresAt_idx" ON "AcademyEnrollment"("expiresAt");
