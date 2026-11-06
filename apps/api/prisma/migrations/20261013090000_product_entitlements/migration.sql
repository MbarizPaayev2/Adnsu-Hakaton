-- AlterEnum
ALTER TYPE "SubscriptionPlan" ADD VALUE 'PREMIUM';

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageCounter_userId_key_idx" ON "UsageCounter"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_userId_key_periodStart_key" ON "UsageCounter"("userId", "key", "periodStart");

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

