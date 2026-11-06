-- Durable webhook de-duplication: one row per provider delivery id.
CREATE TABLE "BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BillingWebhookEvent_subscriptionId_idx" ON "BillingWebhookEvent"("subscriptionId");

-- Provider state mirrored from the subscription itself, not from event order.
ALTER TABLE "Subscription" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN "providerSyncedAt" TIMESTAMP(3);

-- Legacy spelling written by the old cancellation handler.
UPDATE "Subscription" SET "status" = 'cancelled' WHERE "status" = 'canceled';

-- Webhooks look subscriptions up by the provider id.
CREATE INDEX "Subscription_dodoSubscriptionId_idx" ON "Subscription"("dodoSubscriptionId");
