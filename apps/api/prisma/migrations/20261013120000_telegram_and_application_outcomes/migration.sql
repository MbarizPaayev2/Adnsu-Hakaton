-- CreateEnum
CREATE TYPE "TelegramLinkStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "OutcomeKind" AS ENUM ('INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OutcomeEvidence" AS ENUM ('EMPLOYER_CONFIRMED', 'CANDIDATE_REPORTED');

-- CreateTable
CREATE TABLE "TelegramLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "TelegramLinkStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "chatId" TEXT,
    "telegramUserId" TEXT,
    "linkedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramUpdate" (
    "updateId" BIGINT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramUpdate_pkey" PRIMARY KEY ("updateId")
);

-- CreateTable
CREATE TABLE "ApplicationOutcomeEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "outcome" "OutcomeKind" NOT NULL,
    "evidence" "OutcomeEvidence" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationOutcomeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_userId_key" ON "TelegramLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_tokenHash_key" ON "TelegramLink"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_chatId_key" ON "TelegramLink"("chatId");

-- CreateIndex
CREATE INDEX "ApplicationOutcomeEvent_userId_createdAt_idx" ON "ApplicationOutcomeEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationOutcomeEvent_channel_applicationId_outcome_evide_key" ON "ApplicationOutcomeEvent"("channel", "applicationId", "outcome", "evidence");

-- AddForeignKey
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationOutcomeEvent" ADD CONSTRAINT "ApplicationOutcomeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

