-- Additive only: a nullable unique run identity so a repeated collector report is recognised.
-- AlterTable
ALTER TABLE "JobImportRun" ADD COLUMN     "runKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "JobImportRun_runKey_key" ON "JobImportRun"("runKey");

