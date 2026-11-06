-- CreateEnum
CREATE TYPE "VerificationTokenPurpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "VerificationToken" ADD COLUMN     "purpose" "VerificationTokenPurpose" NOT NULL DEFAULT 'EMAIL_VERIFY';
