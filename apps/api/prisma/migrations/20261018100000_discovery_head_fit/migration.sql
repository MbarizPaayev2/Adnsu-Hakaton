-- Whether a board fits a single head run (additive; null = not learned yet).
ALTER TABLE "SourceDiscoveryProgress" ADD COLUMN "headReachedEnd" BOOLEAN;
