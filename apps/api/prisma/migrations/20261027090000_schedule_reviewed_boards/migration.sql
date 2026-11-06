-- Job boards, reviewed one by one on 12 October 2026 against their own published rules (robots.txt and the terms pages each site publishes).
-- Scheduled (daily-ish, bounded budgets, politeness floors unchanged; pause or remove on request):
--   hellojob  robots allows everything; its rules page (/page/qaydalar) restricts how companies post and how the CV pool is used, and says nothing against reading public vacancy pages.
--   smartjob  robots allows the vacancy pages (it disallows /api/ and account paths, which the collector never touches); terms of 6 Sep 2026 contain no clause on automated access.
-- Restricted (never scheduled; documented prohibition):
--   work      user agreement lists "automated programs and bots collecting data" among prohibited activities.
--   boss      terms-conditions 8.3 prohibits obtaining access "with automatic programs".
-- Unchanged (held): ejob, jobsearch (no published terms; imports stay off until written permission is recorded).
-- Not collected, no source row: busy.az (terms prohibit bots/scraping and building databases from its content), jobsite.az (terms prohibit bots, scrapers, crawlers without written permission).
UPDATE "JobSource" SET
  "scheduled" = true, "enabled" = true, "intervalMinutes" = 720, "nextRunAt" = CURRENT_TIMESTAMP, "reviewedAt" = CURRENT_TIMESTAMP,
  "accessNote" = 'Reviewed 12 Oct 2026: robots.txt allows all; the rules page (hellojob.az/page/qaydalar) has no clause against reading public vacancy pages (it restricts the CV pool, which is never read). Original links and attribution kept; pause or remove on request.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'hellojob' AND "accessReview" <> 'RESTRICTED';

UPDATE "JobSource" SET
  "scheduled" = true, "enabled" = true, "intervalMinutes" = 720, "nextRunAt" = CURRENT_TIMESTAMP, "reviewedAt" = CURRENT_TIMESTAMP,
  "accessNote" = 'Reviewed 12 Oct 2026: robots.txt allows the vacancy pages (disallows /api/ and account paths, never touched); terms of 6 Sep 2026 have no clause on automated access. Original links and attribution kept; pause or remove on request.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'smartjob' AND "accessReview" <> 'RESTRICTED';

UPDATE "JobSource" SET
  "accessReview" = 'RESTRICTED', "enabled" = false, "scheduled" = false, "reviewedAt" = CURRENT_TIMESTAMP,
  "accessNote" = 'Restricted 12 Oct 2026: the user agreement lists "automated programs and bots collecting data" among prohibited activities. Not collected without written permission.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'work';

UPDATE "JobSource" SET
  "accessReview" = 'RESTRICTED', "enabled" = false, "scheduled" = false, "reviewedAt" = CURRENT_TIMESTAMP,
  "accessNote" = 'Restricted 12 Oct 2026: terms-conditions 8.3 prohibits obtaining access with automatic programs. Not collected without written permission.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'boss';

INSERT INTO "AdminAuditLog" ("id","adminUserId","action","targetType","targetId","metadata","createdAt")
SELECT 'mig20261027-' || "key", NULL, 'SOURCE_SCHEDULE_CHANGED', 'JobSource', "key",
       jsonb_build_object('scheduled', "scheduled", 'intervalMinutes', "intervalMinutes", 'accessReview', "accessReview"::text, 'actor', 'release migration 20261027090000', 'basis', 'access review of 12 October 2026 against the site''s published rules'),
       CURRENT_TIMESTAMP
FROM "JobSource" WHERE "key" IN ('hellojob','smartjob','work','boss')
ON CONFLICT ("id") DO NOTHING;
