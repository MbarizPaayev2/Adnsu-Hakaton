-- Candidate-pasted vacancy data is retained only with the candidate's own generated document.
ALTER TABLE "Resume" ADD COLUMN "privateVacancy" JSONB;
