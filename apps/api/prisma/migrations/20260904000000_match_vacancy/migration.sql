-- Vacancy-side matches: employer-posted platform vacancies become matchable
-- alongside external/scraped jobs. Exactly one of jobId/vacancyId is set per
-- row (enforced in MatchingService.upsertMatch, since Prisma has no CHECK
-- support). Postgres treats NULLs as distinct in UNIQUE indexes, so the two
-- partial-style uniques below coexist: job matches dedupe on (user,job),
-- vacancy matches on (user,vacancy).

-- AlterTable
ALTER TABLE "Match" ALTER COLUMN "jobId" DROP NOT NULL;
ALTER TABLE "Match" ADD COLUMN "vacancyId" TEXT;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "Match_userId_vacancyId_key" ON "Match"("userId", "vacancyId");
