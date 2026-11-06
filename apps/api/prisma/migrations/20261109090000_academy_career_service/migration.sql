-- CreateEnum
CREATE TYPE "AcademyRole" AS ENUM ('OWNER', 'ADMIN', 'COACH');

-- CreateEnum
CREATE TYPE "AcademyStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CohortStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('INVITED', 'ACTIVE', 'WITHDRAWN', 'GRADUATED');

-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('AGGREGATE_ONLY', 'SHARED_DOCUMENTS');

-- CreateTable
CREATE TABLE "Academy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "website" TEXT,
    "status" "AcademyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Academy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyMember" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AcademyRole" NOT NULL DEFAULT 'COACH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyStaffInvitation" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "AcademyRole" NOT NULL DEFAULT 'COACH',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademyStaffInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyCohort" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "CohortStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyCohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyEnrollment" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "userId" TEXT,
    "invitedEmail" TEXT NOT NULL,
    "inviteToken" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'INVITED',
    "joinedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyConsent" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "scope" "ConsentScope" NOT NULL DEFAULT 'AGGREGATE_ONLY',
    "consentTextVersion" TEXT NOT NULL DEFAULT 'v1.0',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AcademyConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Academy_slug_key" ON "Academy"("slug");
CREATE INDEX "Academy_status_idx" ON "Academy"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyMember_academyId_userId_key" ON "AcademyMember"("academyId", "userId");
CREATE INDEX "AcademyMember_userId_idx" ON "AcademyMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyStaffInvitation_token_key" ON "AcademyStaffInvitation"("token");
CREATE INDEX "AcademyStaffInvitation_academyId_email_idx" ON "AcademyStaffInvitation"("academyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyCohort_academyId_slug_key" ON "AcademyCohort"("academyId", "slug");
CREATE INDEX "AcademyCohort_academyId_status_idx" ON "AcademyCohort"("academyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyEnrollment_inviteToken_key" ON "AcademyEnrollment"("inviteToken");
CREATE UNIQUE INDEX "AcademyEnrollment_cohortId_invitedEmail_key" ON "AcademyEnrollment"("cohortId", "invitedEmail");
CREATE INDEX "AcademyEnrollment_academyId_status_idx" ON "AcademyEnrollment"("academyId", "status");
CREATE INDEX "AcademyEnrollment_userId_idx" ON "AcademyEnrollment"("userId");

-- CreateIndex
CREATE INDEX "AcademyConsent_academyId_userId_idx" ON "AcademyConsent"("academyId", "userId");
CREATE INDEX "AcademyConsent_enrollmentId_idx" ON "AcademyConsent"("enrollmentId");

-- AddForeignKey
ALTER TABLE "AcademyMember" ADD CONSTRAINT "AcademyMember_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademyMember" ADD CONSTRAINT "AcademyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyStaffInvitation" ADD CONSTRAINT "AcademyStaffInvitation_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyCohort" ADD CONSTRAINT "AcademyCohort_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyEnrollment" ADD CONSTRAINT "AcademyEnrollment_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademyEnrollment" ADD CONSTRAINT "AcademyEnrollment_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "AcademyCohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademyEnrollment" ADD CONSTRAINT "AcademyEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyConsent" ADD CONSTRAINT "AcademyConsent_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "AcademyEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademyConsent" ADD CONSTRAINT "AcademyConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademyConsent" ADD CONSTRAINT "AcademyConsent_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
