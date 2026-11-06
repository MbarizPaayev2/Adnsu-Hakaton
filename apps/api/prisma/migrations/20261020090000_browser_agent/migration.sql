-- CreateEnum
CREATE TYPE "AgentMode" AS ENUM ('ASSISTED', 'AUTONOMOUS');

-- CreateEnum
CREATE TYPE "AgentCampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED', 'EXPIRED', 'STOPPED');

-- CreateEnum
CREATE TYPE "AgentApplicationState" AS ENUM ('QUEUED', 'PREPARING', 'AWAITING_INPUT', 'READY', 'SUBMITTING', 'SUBMITTED', 'FAILED', 'CANCELLED', 'UNCERTAIN');

-- CreateTable
CREATE TABLE "AgentCampaign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "AgentMode" NOT NULL,
    "status" "AgentCampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "portals" TEXT[],
    "employerAllow" TEXT[],
    "employerDeny" TEXT[],
    "targetRoles" TEXT[],
    "locations" TEXT[],
    "criteria" JSONB NOT NULL,
    "resumeId" TEXT NOT NULL,
    "resumeSha256" TEXT NOT NULL,
    "coverNote" TEXT,
    "answers" JSONB NOT NULL,
    "alwaysAsk" TEXT[],
    "dailyLimit" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consentVersion" INTEGER NOT NULL,
    "consentHash" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "pausedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "applyUrl" TEXT NOT NULL,
    "mode" "AgentMode" NOT NULL,
    "state" "AgentApplicationState" NOT NULL DEFAULT 'QUEUED',
    "stateReason" TEXT,
    "matchScore" DOUBLE PRECISION,
    "matchedKeywords" JSONB,
    "plan" JSONB,
    "planHash" TEXT,
    "questions" JSONB,
    "declarationHash" TEXT,
    "approvedPlanHash" TEXT,
    "approvedAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "permitId" TEXT,
    "permitIssuedAt" TIMESTAMP(3),
    "confirmation" TEXT,
    "evidence" JSONB,
    "submittedAt" TIMESTAMP(3),
    "uncertainAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApplicationEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AgentDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPairingCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentKnownAnswer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "employer" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentKnownAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentCampaign_userId_status_idx" ON "AgentCampaign"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApplication_idempotencyKey_key" ON "AgentApplication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentApplication_campaignId_state_idx" ON "AgentApplication"("campaignId", "state");

-- CreateIndex
CREATE INDEX "AgentApplication_state_leaseUntil_idx" ON "AgentApplication"("state", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApplication_userId_jobId_key" ON "AgentApplication"("userId", "jobId");

-- CreateIndex
CREATE INDEX "AgentApplicationEvent_applicationId_createdAt_idx" ON "AgentApplicationEvent"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDevice_tokenHash_key" ON "AgentDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentDevice_userId_idx" ON "AgentDevice"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPairingCode_codeHash_key" ON "AgentPairingCode"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "AgentKnownAnswer_userId_portal_employer_questionKey_key" ON "AgentKnownAnswer"("userId", "portal", "employer", "questionKey");

-- AddForeignKey
ALTER TABLE "AgentCampaign" ADD CONSTRAINT "AgentCampaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApplication" ADD CONSTRAINT "AgentApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApplication" ADD CONSTRAINT "AgentApplication_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AgentCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApplication" ADD CONSTRAINT "AgentApplication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApplicationEvent" ADD CONSTRAINT "AgentApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AgentApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDevice" ADD CONSTRAINT "AgentDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPairingCode" ADD CONSTRAINT "AgentPairingCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentKnownAnswer" ADD CONSTRAINT "AgentKnownAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

