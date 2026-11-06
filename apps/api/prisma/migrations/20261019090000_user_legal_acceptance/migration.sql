-- Additive: records the Terms/Privacy acceptance given at sign-up. Existing users keep NULL (accepted before it was recorded).
ALTER TABLE "User" ADD COLUMN "legalAcceptedAt" TIMESTAMP(3),
ADD COLUMN "legalVersion" TEXT,
ADD COLUMN "legalAcceptedVia" TEXT;
