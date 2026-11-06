-- Read-only acquisition baseline on the actionable predicate (actionableJobWhere in apps/api/src/jobs/jobs.service.ts).
-- Run before a collector release so the after-snapshot from `report-acquisition-metrics` has a same-predicate "before":
--   docker compose exec -T postgres psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f - < scripts/acquisition-baseline.sql
-- It only SELECTs inside a READ ONLY transaction. Regions are not computed here (the TypeScript report classifies locations).
BEGIN TRANSACTION READ ONLY;

\echo '== actionable totals'
SELECT now() AS measured_at,
       COUNT(*) AS actionable_postings,
       COUNT(DISTINCT "companyKey") AS distinct_company_keys,
       COUNT(*) FILTER (WHERE "applicationMethod" = 'EMAIL' AND "applicationEmail" IS NOT NULL) AS email_bearing,
       COUNT(DISTINCT "companyKey") FILTER (WHERE "applicationMethod" = 'EMAIL' AND "applicationEmail" IS NOT NULL) AS email_employers,
       COUNT(*) FILTER (WHERE "postedAt" >= now() - interval '7 days') AS posted_7d,
       COUNT(*) FILTER (WHERE "postedAt" >= now() - interval '30 days') AS posted_30d,
       COUNT(*) FILTER (WHERE "lastSeenAt" >= now() - interval '48 hours') AS seen_48h
FROM "Job"
WHERE status = 'ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline >= now());

\echo '== actionable by source'
SELECT split_part("externalId", ':', 1) AS source, COUNT(*) AS postings, COUNT(DISTINCT "companyKey") AS employers,
       COUNT(*) FILTER (WHERE "applicationMethod" = 'EMAIL' AND "applicationEmail" IS NOT NULL) AS email
FROM "Job"
WHERE status = 'ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline >= now())
GROUP BY 1 ORDER BY 2 DESC;

\echo '== actionable by location text (top 40)'
SELECT location, COUNT(*) FROM "Job"
WHERE status = 'ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline >= now())
GROUP BY 1 ORDER BY 2 DESC LIMIT 40;

\echo '== last 7 days: ingested, duplicates, closed'
SELECT COUNT(*) AS ingested_7d,
       COUNT(*) FILTER (WHERE "duplicateOfId" IS NOT NULL) AS ingested_dup_linked,
       (SELECT COUNT(*) FROM "Job" WHERE "closedAt" >= now() - interval '7 days') AS closed_7d
FROM "Job" WHERE "ingestedAt" >= now() - interval '7 days';

ROLLBACK;
