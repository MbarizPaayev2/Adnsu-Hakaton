-- CreateEnum
CREATE TYPE "CandidateOutcomeType" AS ENUM ('INTERVIEW', 'OFFER_RECEIVED', 'OFFER_ACCEPTED', 'JOB_STARTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OutcomeVerificationStatus" AS ENUM ('UNVERIFIED', 'STUDENT_ATTESTED', 'EMPLOYER_CONFIRMED');

-- CreateTable
CREATE TABLE "CandidateOutcome" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcomeType" "CandidateOutcomeType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "jobTitle" TEXT,
    "companyName" TEXT,
    "channel" TEXT,
    "applicationId" TEXT,
    "verificationStatus" "OutcomeVerificationStatus" NOT NULL DEFAULT 'STUDENT_ATTESTED',
    "note" TEXT,
    "shareWithAcademy" BOOLEAN NOT NULL DEFAULT true,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateOutcome_userId_outcomeType_idx" ON "CandidateOutcome"("userId", "outcomeType");

-- CreateIndex
CREATE INDEX "CandidateOutcome_userId_withdrawnAt_idx" ON "CandidateOutcome"("userId", "withdrawnAt");

-- AddForeignKey
ALTER TABLE "CandidateOutcome" ADD CONSTRAINT "CandidateOutcome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
