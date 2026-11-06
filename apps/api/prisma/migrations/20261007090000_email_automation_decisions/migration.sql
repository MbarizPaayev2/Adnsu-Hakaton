-- Additive only: one new table recording why automatic e-mail applications applied or stopped.
-- CreateTable
CREATE TABLE "EmailAutomationDecision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAutomationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailAutomationDecision_userId_createdAt_idx" ON "EmailAutomationDecision"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAutomationDecision_userId_jobId_key" ON "EmailAutomationDecision"("userId", "jobId");

