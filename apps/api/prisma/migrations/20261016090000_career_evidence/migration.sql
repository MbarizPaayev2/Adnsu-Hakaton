-- CreateEnum
CREATE TYPE "CareerEntryKind" AS ENUM ('PROJECT', 'VOLUNTEERING', 'LEADERSHIP', 'EXTRACURRICULAR', 'CERTIFICATION', 'LANGUAGE', 'AWARD', 'STORY', 'OTHER');

-- CreateEnum
CREATE TYPE "CareerEntryStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "CareerEntryOrigin" AS ENUM ('EXTRACTED', 'USER_ADDED');

-- CreateTable
CREATE TABLE "CareerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CareerEntryKind" NOT NULL,
    "status" "CareerEntryStatus" NOT NULL DEFAULT 'SUGGESTED',
    "origin" "CareerEntryOrigin" NOT NULL,
    "title" TEXT NOT NULL,
    "organization" TEXT,
    "role" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "current" BOOLEAN NOT NULL DEFAULT false,
    "issuedAt" TIMESTAMP(3),
    "level" TEXT,
    "description" TEXT,
    "result" TEXT,
    "situation" TEXT,
    "action" TEXT,
    "url" TEXT,
    "alwaysInclude" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourceEvidence" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareerEntry_userId_kind_status_idx" ON "CareerEntry"("userId", "kind", "status");

-- AddForeignKey
ALTER TABLE "CareerEntry" ADD CONSTRAINT "CareerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

