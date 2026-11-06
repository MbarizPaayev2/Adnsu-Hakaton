-- Phase 5: truthful external-application states, scoped consent and
-- persisted send attempts. Additive only; existing rows keep their values.

-- AlterEnum
ALTER TYPE "ExternalApplicationStatus" ADD VALUE 'SUBMITTING';
ALTER TYPE "ExternalApplicationStatus" ADD VALUE 'DELIVERY_UNCONFIRMED';

-- AlterTable
ALTER TABLE "ExternalApplication" ADD COLUMN     "activeAttemptId" TEXT,
ADD COLUMN     "cvSnapshotSha256" TEXT,
ADD COLUMN     "cvSnapshotUrl" TEXT,
ADD COLUMN     "destinationHost" TEXT,
ADD COLUMN     "destinationKey" TEXT,
ADD COLUMN     "dryRun" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "idDocumentSnapshotUrl" TEXT,
ADD COLUMN     "receiptEvidence" JSONB,
ADD COLUMN     "receiptReference" TEXT,
ADD COLUMN     "reviewVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stateReason" TEXT;

-- CreateTable
CREATE TABLE "ExternalApplicationConsent" (
    "id" TEXT NOT NULL,
    "externalApplicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "destinationKey" TEXT NOT NULL,
    "destinationHost" TEXT NOT NULL,
    "applyUrl" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "noticeHash" TEXT NOT NULL,
    "noticeUrl" TEXT NOT NULL,
    "approvedFields" JSONB NOT NULL,
    "disclosure" JSONB NOT NULL,
    "disclosureHash" TEXT NOT NULL,
    "approvedDocuments" JSONB NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "ExternalApplicationConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalApplicationAttempt" (
    "id" TEXT NOT NULL,
    "externalApplicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "outcomeCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalApplicationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalApplicationConsent_externalApplicationId_idx" ON "ExternalApplicationConsent"("externalApplicationId");

-- CreateIndex
CREATE INDEX "ExternalApplicationConsent_userId_idx" ON "ExternalApplicationConsent"("userId");

-- CreateIndex
CREATE INDEX "ExternalApplicationAttempt_externalApplicationId_idx" ON "ExternalApplicationAttempt"("externalApplicationId");

-- CreateIndex
CREATE INDEX "ExternalApplicationAttempt_userId_startedAt_idx" ON "ExternalApplicationAttempt"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "ExternalApplicationConsent" ADD CONSTRAINT "ExternalApplicationConsent_externalApplicationId_fkey" FOREIGN KEY ("externalApplicationId") REFERENCES "ExternalApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalApplicationAttempt" ADD CONSTRAINT "ExternalApplicationAttempt_externalApplicationId_fkey" FOREIGN KEY ("externalApplicationId") REFERENCES "ExternalApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
