-- CreateEnum
CREATE TYPE "ResumeStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Resume" ADD COLUMN     "status" "ResumeStatus" NOT NULL DEFAULT 'READY',
ADD COLUMN     "statusError" TEXT,
ALTER COLUMN "fileUrl" DROP NOT NULL;
