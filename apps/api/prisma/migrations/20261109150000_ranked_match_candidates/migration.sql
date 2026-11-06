CREATE TABLE "MatchCandidate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "vacancyId" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "details" JSONB NOT NULL,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchCandidate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MatchCandidate_exactly_one_target_check" CHECK (
        (CASE WHEN "jobId" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "vacancyId" IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);

CREATE UNIQUE INDEX "MatchCandidate_userId_jobId_key" ON "MatchCandidate"("userId", "jobId");
CREATE UNIQUE INDEX "MatchCandidate_userId_vacancyId_key" ON "MatchCandidate"("userId", "vacancyId");
CREATE INDEX "MatchCandidate_userId_score_scoredAt_idx" ON "MatchCandidate"("userId", "score", "scoredAt");

ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_vacancyId_fkey"
    FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
