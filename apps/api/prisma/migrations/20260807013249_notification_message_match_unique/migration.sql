-- Add message column, backfill existing rows from payload, then enforce NOT NULL
ALTER TABLE "Notification" ADD COLUMN "message" TEXT;

UPDATE "Notification"
SET "message" = CASE
  WHEN "type" = 'NEW_MATCH' THEN
    'New match: ' || COALESCE("payload"->>'jobTitle', 'a job') ||
    COALESCE(' at ' || NULLIF("payload"->>'company', ''), '')
  WHEN "type" = 'DIGEST' THEN
    COALESCE("payload"->>'matchCount', '0') || ' new job matches found'
  ELSE 'Notification'
END
WHERE "message" IS NULL;

ALTER TABLE "Notification" ALTER COLUMN "message" SET NOT NULL;

-- Prevent duplicate Match rows for the same user/job pair
CREATE UNIQUE INDEX "Match_userId_jobId_key" ON "Match"("userId", "jobId");
