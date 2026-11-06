-- Prompt 2: founder super-admin, scoped operator roles, MFA, invitations.

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SUPPORT');

-- Existing operators keep the access they have today (ADMIN), never more.
ALTER TABLE "AdminUser" ADD COLUMN "role" "AdminRole" NOT NULL DEFAULT 'ADMIN';
-- New operators start with the least privilege.
ALTER TABLE "AdminUser" ALTER COLUMN "role" SET DEFAULT 'SUPPORT';
ALTER TABLE "AdminUser" ADD COLUMN "disabledAt" TIMESTAMP(3),
ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN "lastLoginAt" TIMESTAMP(3),
ADD COLUMN "mfaSecretEnc" TEXT,
ADD COLUMN "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN "mfaRecoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "mfaLastUsedStep" INTEGER;

-- Trusted, code-reviewed designation of the known founder account only. It
-- matches an existing row (never creates one) and changes nothing else about
-- it: identity, password and audit history are preserved.
UPDATE "AdminUser" SET "role" = 'SUPER_ADMIN' WHERE lower("email") = 'ceo@aisehr.com';

-- AlterTable
ALTER TABLE "AdminSession" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lastSeenAt" TIMESTAMP(3),
ADD COLUMN "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "userAgent" TEXT;

-- CreateIndex
CREATE INDEX "AdminSession_adminUserId_idx" ON "AdminSession"("adminUserId");

-- CreateTable
CREATE TABLE "AdminInvitation" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLoginChallenge" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLoginChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminInvitation_tokenHash_key" ON "AdminInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminInvitation_email_idx" ON "AdminInvitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminLoginChallenge_tokenHash_key" ON "AdminLoginChallenge"("tokenHash");

-- AddForeignKey
ALTER TABLE "AdminInvitation" ADD CONSTRAINT "AdminInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
