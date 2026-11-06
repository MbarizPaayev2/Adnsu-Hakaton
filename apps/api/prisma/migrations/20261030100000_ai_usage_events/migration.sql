-- Privacy-preserving model usage and document timing records (no content). Additive.
CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumeId" TEXT,
    "docKind" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiUsageEvent_createdAt_idx" ON "AiUsageEvent"("createdAt");
CREATE INDEX "AiUsageEvent_resumeId_idx" ON "AiUsageEvent"("resumeId");

CREATE TABLE "DocumentRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumeId" TEXT NOT NULL,
    "docKind" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "errorCode" TEXT,
    "queueMs" INTEGER,
    "generationMs" INTEGER NOT NULL,
    "renderMs" INTEGER,
    "calls" INTEGER NOT NULL,
    CONSTRAINT "DocumentRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentRun_createdAt_idx" ON "DocumentRun"("createdAt");
