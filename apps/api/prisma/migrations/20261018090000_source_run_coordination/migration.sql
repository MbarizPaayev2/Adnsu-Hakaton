-- Source run coordination (additive): one lease with an owner for the scheduler, run-now and the import CLI; a durable cooldown after repeated failure;
-- and persisted deeper-traversal progress per source. No existing row or column is changed.
ALTER TABLE "JobSource" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "leaseHeartbeatAt" TIMESTAMP(3);
ALTER TABLE "JobSource" ADD COLUMN "cooldownUntil" TIMESTAMP(3);
ALTER TABLE "JobSource" ADD COLUMN "cooldownReason" TEXT;
ALTER TABLE "JobSource" ADD COLUMN "cooldownCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SourceDiscoveryProgress" (
    "sourceKey" TEXT NOT NULL,
    "generation" TEXT NOT NULL,
    "cursor" JSONB,
    "anchors" JSONB,
    "segments" INTEGER NOT NULL DEFAULT 0,
    "listedInGeneration" INTEGER NOT NULL DEFAULT 0,
    "lastHeadAt" TIMESTAMP(3),
    "lastSegmentAt" TIMESTAMP(3),
    "lastDeepCompletedAt" TIMESTAMP(3),
    "restartReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceDiscoveryProgress_pkey" PRIMARY KEY ("sourceKey")
);

ALTER TABLE "SourceDiscoveryProgress" ADD CONSTRAINT "SourceDiscoveryProgress_sourceKey_fkey" FOREIGN KEY ("sourceKey") REFERENCES "JobSource"("key") ON DELETE CASCADE ON UPDATE CASCADE;
