-- Replace the SubscriptionPlan enum's values (FREE, PRO, PREMIUM) with the new
-- plan tiers (FREE, BASIC, STANDARD, Limitsiz). Done via a TEXT intermediate
-- column instead of ALTER TYPE ... ADD VALUE, since newly-added enum values
-- can't be referenced in the same transaction they were added in.
ALTER TABLE "Subscription" ALTER COLUMN "plan" TYPE TEXT;
ALTER TABLE "Subscription" ALTER COLUMN "plan" DROP DEFAULT;

UPDATE "Subscription" SET "plan" = CASE "plan"
  WHEN 'PRO' THEN 'STANDARD'
  WHEN 'PREMIUM' THEN 'Limitsiz'
  ELSE "plan"
END;

DROP TYPE "SubscriptionPlan";
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'BASIC', 'STANDARD', 'Limitsiz');

ALTER TABLE "Subscription" ALTER COLUMN "plan" TYPE "SubscriptionPlan" USING "plan"::"SubscriptionPlan";
ALTER TABLE "Subscription" ALTER COLUMN "plan" SET DEFAULT 'FREE';

-- Monthly match-quota tracking, independent of Paddle's billing period.
ALTER TABLE "Subscription" ADD COLUMN "matchesUsedThisPeriod" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN "quotaPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Tracks whether a Match has already been included in a sent match-alert email.
ALTER TABLE "Match" ADD COLUMN "notifiedAt" TIMESTAMP(3);
