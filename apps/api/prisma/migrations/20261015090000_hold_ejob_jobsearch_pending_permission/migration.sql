-- eJob.az and JobSearch.az publish no terms that permit reuse or republication of their vacancy content: eJob states "all rights reserved" and says it applies
-- technical measures against automated parsing; JobSearch publishes no terms page at all (see docs/source-access-and-attribution-2026-10-03.md).
-- robots.txt allowing the paths is not permission to republish. Until the owners give written permission, imports from these two sources are refused by the
-- ingestion API (assertIngestable requires an enabled source), so nothing can be published from them in any environment that has applied this migration.
-- Additive and reversible: only the "enabled" flag and the note change, for these two keys; no other source or row is touched.
UPDATE "JobSource"
SET "enabled" = false,
    "accessNote" = COALESCE("accessNote", '') || ' HELD 2026-10-03: no published terms permit reuse/republication; imports disabled until written permission is recorded.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" IN ('ejob', 'jobsearch') AND "enabled" = true;
