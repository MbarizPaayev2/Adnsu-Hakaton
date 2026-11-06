-- Review queue: background find-and-prepare, sent only after the candidate approves each application. Additive only.
ALTER TABLE "EmailApplySettings" ADD COLUMN "reviewQueueEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmailApplySettings" ADD COLUMN "reviewQueueSince" TIMESTAMP(3);
ALTER TABLE "EmailApplication" ADD COLUMN "preparedByAgentAt" TIMESTAMP(3);
ALTER TYPE "NotificationType" ADD VALUE 'AGENT_REVIEW';
