-- Wolt Azerbaijan's career site is hosted on Greenhouse (verified: official careers.wolt.com links to job-boards.greenhouse.io/wolt).
-- Registers Wolt as a verified original employer source using the public Greenhouse JSON API.
-- Registered disabled and unscheduled by default pending production enablement review.
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","intervalMinutes","nextRunAt","updatedAt")
VALUES ('wolt','Wolt Azerbaijan (Greenhouse)','Wolt Azerbaijan','https://job-boards.greenhouse.io/wolt','public-greenhouse-json-api','Public Greenhouse JSON feed for Wolt; requisitions with an Azerbaijani location only',
 'ROBOTS_ALLOWED_TERMS_PENDING','Verified 27 October 2026: official site careers.wolt.com links to job-boards.greenhouse.io/wolt. robots.txt allows public jobs API. Registered disabled and unscheduled by default pending review.',
 ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],false,false,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- No audit event: ON CONFLICT may leave an existing operator-controlled row unchanged.
