-- Two more official employer sources, scheduled daily under the founder's standing authorization for official employer sources (12 October 2026 brief).
-- Additive and reversible: one source row is upserted, one existing row is scheduled, two audit rows record the change with no human actor (a release migration).
--
-- kapital: the Kapital Bank group's own career site (careers.bir.az: Bir, Birbank, m10, Birmarket) reads its vacancies from two public GET endpoints on
--   apihr.kapitalbank.az; no robots.txt is published, no terms found. 63 postings on 11 October, regional branches included. Collector: kapital.collector.ts.
-- yelo: Yelo Bank's own career page; the reviewed collector read 8 postings on 11 October (complete listing).
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","intervalMinutes","nextRunAt","updatedAt")
VALUES ('kapital','Kapital Bank group (Bir, Birbank, m10, Birmarket)','Kapital Bank','https://careers.bir.az/vacancies','public-json-api-of-employer-career-site','Public vacancy list and detail endpoints the employer''s own career site reads (apihr.kapitalbank.az); Azerbaijan postings; branch places only where the posting names them','ROBOTS_ALLOWED_TERMS_PENDING','No robots.txt is published (app shell / 404); no terms found; employer-owned public endpoints used by its own site. Attribution not reviewed; pause, hide or remove on request.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "enabled" = true, "scheduled" = true, "nextRunAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "JobSource" SET "scheduled" = true, "nextRunAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'yelo' AND "enabled" = true AND "accessReview" <> 'RESTRICTED';

INSERT INTO "AdminAuditLog" ("id","adminUserId","action","targetType","targetId","metadata","createdAt")
SELECT 'mig20261024-' || "key", NULL, 'SOURCE_SCHEDULE_CHANGED', 'JobSource', "key",
       jsonb_build_object('scheduled', true, 'intervalMinutes', 1440, 'actor', 'release migration 20261024090000', 'basis', 'standing authorization for official employer sources'),
       CURRENT_TIMESTAMP
FROM "JobSource" WHERE "key" IN ('kapital','yelo') AND "scheduled" = true
ON CONFLICT ("id") DO NOTHING;
