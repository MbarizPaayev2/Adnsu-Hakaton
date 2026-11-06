-- Additive only: schedule columns on the source registry; every existing source stays unscheduled.
-- AlterTable
ALTER TABLE "JobSource" ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "intervalMinutes" INTEGER NOT NULL DEFAULT 1440,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "schedulePausedAt" TIMESTAMP(3);

