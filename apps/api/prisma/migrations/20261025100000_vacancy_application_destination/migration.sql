-- Employer-chosen e-mail destination for "new application" notices, one per vacancy. Additive: a new table, nothing existing changes.
CREATE TABLE "VacancyApplicationDestination" (
    "vacancyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacancyApplicationDestination_pkey" PRIMARY KEY ("vacancyId")
);

ALTER TABLE "VacancyApplicationDestination" ADD CONSTRAINT "VacancyApplicationDestination_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
