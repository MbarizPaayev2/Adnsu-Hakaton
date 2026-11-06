-- CreateEnum
CREATE TYPE "NotifyFrequency" AS ENUM ('OFF', 'DAILY', 'INSTANT');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('IN_APP', 'EMAIL', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "AlertDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'NEW_JOB';

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchInApp" BOOLEAN NOT NULL DEFAULT true,
    "matchEmail" BOOLEAN NOT NULL DEFAULT true,
    "newJobInApp" BOOLEAN NOT NULL DEFAULT true,
    "newJobEmail" "NotifyFrequency" NOT NULL DEFAULT 'DAILY',
    "newJobTelegram" "NotifyFrequency" NOT NULL DEFAULT 'OFF',
    "matchTelegram" BOOLEAN NOT NULL DEFAULT false,
    "instantDailyCap" INTEGER NOT NULL DEFAULT 5,
    "quietStartMinute" INTEGER,
    "quietEndMinute" INTEGER,
    "pausedUntil" TIMESTAMP(3),
    "emailUnsubscribedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "jobId" TEXT,
    "vacancyId" TEXT,
    "reasons" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channel" "AlertChannel" NOT NULL,
    "frequency" "NotifyFrequency" NOT NULL,
    "status" "AlertDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "skipReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "AlertEvent_userId_createdAt_idx" ON "AlertEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlertEvent_userId_dedupeKey_key" ON "AlertEvent"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AlertDelivery_channel_status_idx" ON "AlertDelivery"("channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AlertDelivery_eventId_channel_key" ON "AlertDelivery"("eventId", "channel");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AlertEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

