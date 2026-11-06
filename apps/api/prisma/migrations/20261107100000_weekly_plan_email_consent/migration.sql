ALTER TYPE "NotificationType" ADD VALUE 'PLAN_OFFER';
ALTER TABLE "NotificationPreference" ADD COLUMN "planOffersEmail" BOOLEAN NOT NULL DEFAULT false;
