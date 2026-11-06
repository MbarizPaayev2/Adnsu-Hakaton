-- Prompt 3: operator moderation, suspension, durable feature switches and
-- auditable plan overrides. Additive only.

-- AlterEnum
ALTER TYPE "BusinessStatus" ADD VALUE 'SUSPENDED';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "suspendedReason" TEXT;
ALTER TABLE "Job" ADD COLUMN "hiddenAt" TIMESTAMP(3), ADD COLUMN "hiddenReason" TEXT;
ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMP(3), ADD COLUMN "suspendedReason" TEXT;

-- CreateTable
CREATE TABLE "PlanOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "PlanOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "PlanOverride_userId_expiresAt_idx" ON "PlanOverride"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "PlanOverride" ADD CONSTRAINT "PlanOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
