-- AlterEnum
ALTER TYPE "ResumeStatus" ADD VALUE 'NEEDS_REVIEW';

-- AlterTable
ALTER TABLE "Resume" ADD COLUMN     "generationMeta" JSONB,
ADD COLUMN     "reviewNotes" JSONB,
ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Resume_userId_matchId_status_idx" ON "Resume"("userId", "matchId", "status");

