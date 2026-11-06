-- CreateEnum
CREATE TYPE "ExternalApplicationStatus" AS ENUM ('DRAFT', 'FILLING', 'NEEDS_INPUT', 'READY_FOR_REVIEW', 'AWAITING_OTP', 'SUBMITTED', 'SUBMITTED_DRY_RUN', 'FAILED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "address" TEXT,
ADD COLUMN     "citizenship" TEXT,
ADD COLUMN     "defaultCoverLetter" TEXT,
ADD COLUMN     "dob" TIMESTAMP(3),
ADD COLUMN     "idDocumentUrl" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "preferredCurrency" TEXT,
ADD COLUMN     "preferredNetGross" TEXT,
ADD COLUMN     "salaryExpectation" INTEGER;

-- CreateTable
CREATE TABLE "ExternalApplication" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ExternalApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "applyUrl" TEXT NOT NULL,
    "previewData" JSONB,
    "missingFields" JSONB,
    "reviewScreenshotUrl" TEXT,
    "sessionExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalApplicationAnswer" (
    "id" TEXT NOT NULL,
    "externalApplicationId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalApplicationAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalApplication_matchId_idx" ON "ExternalApplication"("matchId");

-- CreateIndex
CREATE INDEX "ExternalApplication_userId_idx" ON "ExternalApplication"("userId");

-- CreateIndex
CREATE INDEX "ExternalApplication_status_idx" ON "ExternalApplication"("status");

-- CreateIndex
CREATE INDEX "ExternalApplicationAnswer_externalApplicationId_idx" ON "ExternalApplicationAnswer"("externalApplicationId");

-- AddForeignKey
ALTER TABLE "ExternalApplication" ADD CONSTRAINT "ExternalApplication_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalApplication" ADD CONSTRAINT "ExternalApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalApplicationAnswer" ADD CONSTRAINT "ExternalApplicationAnswer_externalApplicationId_fkey" FOREIGN KEY ("externalApplicationId") REFERENCES "ExternalApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
