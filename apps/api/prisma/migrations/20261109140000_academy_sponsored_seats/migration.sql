CREATE TYPE "AcademySponsorshipStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');
CREATE TYPE "AcademySeatGrantStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "AcademySponsorship" (
  "id" TEXT NOT NULL,
  "academyId" TEXT NOT NULL,
  "plan" "SubscriptionPlan" NOT NULL,
  "seatCapacity" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" "AcademySponsorshipStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcademySponsorship_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AcademySponsorship_academyId_key" ON "AcademySponsorship"("academyId");
CREATE INDEX "AcademySponsorship_status_startsAt_endsAt_idx" ON "AcademySponsorship"("status", "startsAt", "endsAt");
ALTER TABLE "AcademySponsorship" ADD CONSTRAINT "AcademySponsorship_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AcademySeatGrant" (
  "id" TEXT NOT NULL,
  "academyId" TEXT NOT NULL,
  "sponsorshipId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "plan" "SubscriptionPlan" NOT NULL,
  "status" "AcademySeatGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "grantedById" TEXT NOT NULL,
  "revokedById" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AcademySeatGrant_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AcademySeatGrant_academyId_userId_status_idx" ON "AcademySeatGrant"("academyId", "userId", "status");
CREATE INDEX "AcademySeatGrant_sponsorshipId_status_endsAt_idx" ON "AcademySeatGrant"("sponsorshipId", "status", "endsAt");
CREATE INDEX "AcademySeatGrant_userId_status_endsAt_idx" ON "AcademySeatGrant"("userId", "status", "endsAt");
ALTER TABLE "AcademySeatGrant" ADD CONSTRAINT "AcademySeatGrant_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademySeatGrant" ADD CONSTRAINT "AcademySeatGrant_sponsorshipId_fkey" FOREIGN KEY ("sponsorshipId") REFERENCES "AcademySponsorship"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademySeatGrant" ADD CONSTRAINT "AcademySeatGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlanOverride" ADD COLUMN "academySeatGrantId" TEXT;
CREATE UNIQUE INDEX "PlanOverride_academySeatGrantId_key" ON "PlanOverride"("academySeatGrantId");
ALTER TABLE "PlanOverride" ADD CONSTRAINT "PlanOverride_academySeatGrantId_fkey" FOREIGN KEY ("academySeatGrantId") REFERENCES "AcademySeatGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
