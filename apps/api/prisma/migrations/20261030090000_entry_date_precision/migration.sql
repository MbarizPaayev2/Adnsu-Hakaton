-- Year-only dates stay years, and an undated education record stays undated. Additive: existing rows keep their dates and read as month precision.
ALTER TABLE "Experience" ADD COLUMN "startPrecision" TEXT, ADD COLUMN "endPrecision" TEXT;
ALTER TABLE "Education" ADD COLUMN "startPrecision" TEXT, ADD COLUMN "endPrecision" TEXT;
ALTER TABLE "Education" ALTER COLUMN "startDate" DROP NOT NULL;
