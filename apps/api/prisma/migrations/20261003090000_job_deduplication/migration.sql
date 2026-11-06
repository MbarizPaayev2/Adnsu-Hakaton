-- Additive only: four nullable columns, three indexes and a self-referencing key.
-- Existing rows are untouched (every Job stays its own primary).
ALTER TABLE "Job" ADD COLUMN "canonicalUrl" TEXT;
ALTER TABLE "Job" ADD COLUMN "companyKey" TEXT;
ALTER TABLE "Job" ADD COLUMN "duplicateOfId" TEXT;
ALTER TABLE "Job" ADD COLUMN "duplicateReason" TEXT;

CREATE INDEX "Job_canonicalUrl_idx" ON "Job"("canonicalUrl");
CREATE INDEX "Job_companyKey_idx" ON "Job"("companyKey");
CREATE INDEX "Job_duplicateOfId_idx" ON "Job"("duplicateOfId");

ALTER TABLE "Job" ADD CONSTRAINT "Job_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
