-- CreateEnum
CREATE TYPE "VolunteerOpportunityStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'VOLUNTEER_OPPORTUNITY';

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "volunteerOpportunitiesOptIn" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VolunteerOpportunity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "status" "VolunteerOpportunityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VolunteerOpportunity_status_idx" ON "VolunteerOpportunity"("status");

-- AddForeignKey
ALTER TABLE "VolunteerOpportunity" ADD CONSTRAINT "VolunteerOpportunity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
