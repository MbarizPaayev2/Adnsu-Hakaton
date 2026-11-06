-- Replacing Paddle with Dodo Payments as the payment provider: rename the
-- two provider-identifier columns. A plain rename, not drop+add, so existing
-- subscriptions keep their stored id instead of losing it — those ids are
-- meaningless to Dodo either way, but zeroing them out would strand anyone
-- with a currently-active Paddle subscription with no way to look it up.
ALTER TABLE "Subscription" RENAME COLUMN "paddleCustomerId" TO "dodoCustomerId";
ALTER TABLE "Subscription" RENAME COLUMN "paddleSubscriptionId" TO "dodoSubscriptionId";
