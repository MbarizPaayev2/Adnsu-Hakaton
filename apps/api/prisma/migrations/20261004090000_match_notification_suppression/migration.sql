-- Additive only: one nullable column. Existing matches are untouched (NULL = normal notification rules).
ALTER TABLE "Match" ADD COLUMN "suppressedRollout" TEXT;
