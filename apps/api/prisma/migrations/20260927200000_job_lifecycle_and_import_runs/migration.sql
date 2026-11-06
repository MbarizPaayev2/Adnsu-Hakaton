-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "JobImportStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedReason" TEXT,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "contentUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "detailFetchedAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "missedImports" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "JobStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "JobImportRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "JobImportStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "listingComplete" BOOLEAN NOT NULL DEFAULT false,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "listed" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "reopened" INTEGER NOT NULL DEFAULT 0,
    "closed" INTEGER NOT NULL DEFAULT 0,
    "detailFailures" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "JobImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobImportRun_source_startedAt_idx" ON "JobImportRun"("source", "startedAt");

-- CreateIndex
CREATE INDEX "Job_status_postedAt_idx" ON "Job"("status", "postedAt");


-- Existing rows were last seen when they were ingested, not at migration time.
UPDATE "Job" SET "lastSeenAt" = "ingestedAt", "contentUpdatedAt" = "ingestedAt";
