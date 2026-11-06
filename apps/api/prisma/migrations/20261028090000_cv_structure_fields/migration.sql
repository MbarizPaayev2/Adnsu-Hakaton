-- Additive: where a role was held, the profile paragraph, and the education location, each only as stated by the candidate.
ALTER TABLE "Profile" ADD COLUMN "summary" TEXT;
ALTER TABLE "Experience" ADD COLUMN "location" TEXT;
ALTER TABLE "Education" ADD COLUMN "location" TEXT;
