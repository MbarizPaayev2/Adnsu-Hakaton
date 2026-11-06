-- Additive only: new enums and tables for candidate-approved e-mail applications and their delivery/recruitment tracking. No existing row or column changes.
-- CreateEnum
CREATE TYPE "EmailDeliveryState" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'QUEUED', 'SENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'UNCERTAIN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecruitmentState" AS ENUM ('NOT_SENT', 'SENT', 'ACKNOWLEDGED', 'INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED', 'OFFER', 'REJECTED', 'WITHDRAWN', 'HIRED');

-- CreateEnum
CREATE TYPE "EmailApplicationMode" AS ENUM ('REVIEW_AND_SEND', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "EmailAttemptOutcome" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'RETRYABLE', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "StatusEvidence" AS ENUM ('PROVIDER_ACCEPTED', 'PROVIDER_EVENT', 'CANDIDATE_REPORTED', 'REPLY_CONFIRMED_BY_CANDIDATE', 'SYSTEM');

-- CreateTable
CREATE TABLE "EmailApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "jobTitle" TEXT NOT NULL,
    "jobCompany" TEXT NOT NULL,
    "jobUrl" TEXT NOT NULL,
    "mode" "EmailApplicationMode" NOT NULL DEFAULT 'REVIEW_AND_SEND',
    "deliveryState" "EmailDeliveryState" NOT NULL DEFAULT 'AWAITING_APPROVAL',
    "recruitmentState" "RecruitmentState" NOT NULL DEFAULT 'NOT_SENT',
    "holdReason" TEXT,
    "recipient" TEXT NOT NULL,
    "recipientEvidence" JSONB NOT NULL,
    "instructions" TEXT,
    "reference" TEXT,
    "subject" TEXT NOT NULL,
    "subjectSource" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bodySha256" TEXT NOT NULL,
    "copyToSelf" BOOLEAN NOT NULL DEFAULT true,
    "replyTo" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "cvResumeId" TEXT,
    "cvKind" TEXT NOT NULL,
    "cvFileName" TEXT NOT NULL,
    "cvMimeType" TEXT NOT NULL,
    "cvPreviewSha256" TEXT NOT NULL,
    "cvSnapshotUrl" TEXT,
    "cvSha256" TEXT,
    "cvBytes" INTEGER,
    "payloadSha256" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "consentVersion" TEXT,
    "approvedAt" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "providerAcceptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "complainedAt" TIMESTAMP(3),
    "providerFailedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "uncertainAt" TIMESTAMP(3),
    "interviewAt" TIMESTAMP(3),
    "interviewTimezone" TEXT,
    "interviewNotes" TEXT,
    "reminderOptIn" BOOLEAN NOT NULL DEFAULT false,
    "reminderSentAt" TIMESTAMP(3),
    "replyToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSendAttempt" (
    "id" TEXT NOT NULL,
    "emailApplicationId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" "EmailAttemptOutcome" NOT NULL DEFAULT 'PENDING',
    "httpStatus" INTEGER,
    "errorCode" TEXT,
    "providerMessageId" TEXT,

    CONSTRAINT "EmailSendAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDeliveryEvent" (
    "id" TEXT NOT NULL,
    "svixId" TEXT NOT NULL,
    "emailApplicationId" TEXT,
    "providerMessageId" TEXT,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "detail" TEXT,

    CONSTRAINT "EmailDeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationStatusEvent" (
    "id" TEXT NOT NULL,
    "emailApplicationId" TEXT NOT NULL,
    "fromState" "RecruitmentState",
    "toState" "RecruitmentState" NOT NULL,
    "evidence" "StatusEvidence" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailInboundMessage" (
    "id" TEXT NOT NULL,
    "providerEmailId" TEXT NOT NULL,
    "emailApplicationId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "suggestedState" "RecruitmentState",
    "suggestionReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailInboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailApplySettings" (
    "userId" TEXT NOT NULL,
    "sendingPausedAt" TIMESTAMP(3),
    "consentRevokedAt" TIMESTAMP(3),
    "automationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "automationConsentedAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "allowedRoles" TEXT[],
    "allowedLocations" TEXT[],
    "allowedEmployers" TEXT[],
    "excludedEmployers" TEXT[],
    "excludedKeywords" TEXT[],
    "dailyLimit" INTEGER NOT NULL DEFAULT 3,
    "cvResumeId" TEXT,
    "letterTemplate" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailApplySettings_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailApplication_providerMessageId_key" ON "EmailApplication"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailApplication_replyToken_key" ON "EmailApplication"("replyToken");

-- CreateIndex
CREATE INDEX "EmailApplication_deliveryState_nextAttemptAt_idx" ON "EmailApplication"("deliveryState", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailApplication_userId_createdAt_idx" ON "EmailApplication"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailApplication_recipient_idx" ON "EmailApplication"("recipient");

-- CreateIndex
CREATE UNIQUE INDEX "EmailApplication_userId_jobId_key" ON "EmailApplication"("userId", "jobId");

-- CreateIndex
CREATE INDEX "EmailSendAttempt_outcome_startedAt_idx" ON "EmailSendAttempt"("outcome", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSendAttempt_emailApplicationId_generation_number_key" ON "EmailSendAttempt"("emailApplicationId", "generation", "number");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDeliveryEvent_svixId_key" ON "EmailDeliveryEvent"("svixId");

-- CreateIndex
CREATE INDEX "EmailDeliveryEvent_emailApplicationId_occurredAt_idx" ON "EmailDeliveryEvent"("emailApplicationId", "occurredAt");

-- CreateIndex
CREATE INDEX "EmailDeliveryEvent_providerMessageId_idx" ON "EmailDeliveryEvent"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_email_key" ON "EmailSuppression"("email");

-- CreateIndex
CREATE INDEX "ApplicationStatusEvent_emailApplicationId_createdAt_idx" ON "ApplicationStatusEvent"("emailApplicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailInboundMessage_providerEmailId_key" ON "EmailInboundMessage"("providerEmailId");

-- CreateIndex
CREATE INDEX "EmailInboundMessage_emailApplicationId_receivedAt_idx" ON "EmailInboundMessage"("emailApplicationId", "receivedAt");

-- AddForeignKey
ALTER TABLE "EmailApplication" ADD CONSTRAINT "EmailApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailApplication" ADD CONSTRAINT "EmailApplication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSendAttempt" ADD CONSTRAINT "EmailSendAttempt_emailApplicationId_fkey" FOREIGN KEY ("emailApplicationId") REFERENCES "EmailApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDeliveryEvent" ADD CONSTRAINT "EmailDeliveryEvent_emailApplicationId_fkey" FOREIGN KEY ("emailApplicationId") REFERENCES "EmailApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationStatusEvent" ADD CONSTRAINT "ApplicationStatusEvent_emailApplicationId_fkey" FOREIGN KEY ("emailApplicationId") REFERENCES "EmailApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailInboundMessage" ADD CONSTRAINT "EmailInboundMessage_emailApplicationId_fkey" FOREIGN KEY ("emailApplicationId") REFERENCES "EmailApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailApplySettings" ADD CONSTRAINT "EmailApplySettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

