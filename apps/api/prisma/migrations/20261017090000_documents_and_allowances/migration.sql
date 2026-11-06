-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('CV', 'RESUME', 'LETTER');

-- CreateEnum
CREATE TYPE "DocumentSnapshotKind" AS ENUM ('GENERATED', 'EDITED', 'APPROVED');

-- CreateEnum
CREATE TYPE "DocumentChargeStatus" AS ENUM ('RESERVED', 'COMMITTED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "SubscriptionPlan" ADD VALUE 'PLUS';

-- AlterTable
ALTER TABLE "Resume" ADD COLUMN     "bundleId" TEXT,
ADD COLUMN     "docKind" "DocumentKind" NOT NULL DEFAULT 'CV',
ADD COLUMN     "language" TEXT,
ADD COLUMN     "letterInputs" JSONB,
ADD COLUMN     "provenance" JSONB;

-- CreateTable
CREATE TABLE "DocumentSnapshot" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" "DocumentSnapshotKind" NOT NULL,
    "content" JSONB NOT NULL,
    "provenance" JSONB,
    "contentHash" TEXT NOT NULL,
    "fileSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentCharge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resumeId" TEXT,
    "periodKey" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "status" "DocumentChargeStatus" NOT NULL DEFAULT 'RESERVED',
    "reason" TEXT,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "DocumentCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentSnapshot_resumeId_createdAt_idx" ON "DocumentSnapshot"("resumeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSnapshot_resumeId_revision_kind_key" ON "DocumentSnapshot"("resumeId", "revision", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCharge_resumeId_key" ON "DocumentCharge"("resumeId");

-- CreateIndex
CREATE INDEX "DocumentCharge_userId_periodKey_status_idx" ON "DocumentCharge"("userId", "periodKey", "status");

-- CreateIndex
CREATE INDEX "DocumentCharge_status_expiresAt_idx" ON "DocumentCharge"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Resume_userId_bundleId_idx" ON "Resume"("userId", "bundleId");

-- AddForeignKey
ALTER TABLE "DocumentSnapshot" ADD CONSTRAINT "DocumentSnapshot_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentCharge" ADD CONSTRAINT "DocumentCharge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentCharge" ADD CONSTRAINT "DocumentCharge_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE SET NULL ON UPDATE CASCADE;

