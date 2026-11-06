-- Two official employer announcement pages that state the application e-mail themselves (the first sources with e-mail application routes),
-- scheduled daily under the founder's standing authorization for official employer sources (12 October 2026 brief).
-- Additive and reversible: two source rows are upserted, two audit rows record the change with no human actor (a release migration).
--
-- ada:    ADA University's own career list (ada.edu.az/en/jobs) and one detail page per vacancy; robots.txt has rules for LinkedInBot only.
--         The announcement names the address ("TO APPLY: Email / Subject line / Application deadline").
-- khazar: Khazar University's Jobs and Vacancies page (khazar.org/en/item/510); robots.txt allows everything except /admin.
--         Announcements name the address and the subject; absence from the page never closes a posting (deadlines expire it).
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","intervalMinutes","nextRunAt","updatedAt")
VALUES
('ada','ADA University careers','ADA University','https://www.ada.edu.az/en/jobs','public-html-list+detail-pages','Faculty and staff announcements on the university''s own career page; Baku','ROBOTS_ALLOWED_TERMS_PENDING','robots.txt disallows /jobs and /careers for LinkedInBot only; no rule for other agents. Employer-owned page. Attribution not reviewed; pause, hide or remove on request.',ARRAY['EMAIL','EXTERNAL_SITE']::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('khazar','Khazar University announcements','Khazar University','https://khazar.org/en/item/510','public-html-announcement-page','Staff and faculty announcements on the university''s own Jobs and Vacancies page; Baku','ROBOTS_ALLOWED_TERMS_PENDING','robots.txt allows all except /admin. Employer-owned page. Attribution not reviewed; pause, hide or remove on request.',ARRAY['EMAIL','EXTERNAL_SITE']::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "enabled" = true, "scheduled" = true, "nextRunAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "AdminAuditLog" ("id","adminUserId","action","targetType","targetId","metadata","createdAt")
SELECT 'mig20261025-' || "key", NULL, 'SOURCE_SCHEDULE_CHANGED', 'JobSource', "key",
       jsonb_build_object('scheduled', true, 'intervalMinutes', 1440, 'actor', 'release migration 20261025090000', 'basis', 'standing authorization for official employer sources'),
       CURRENT_TIMESTAMP
FROM "JobSource" WHERE "key" IN ('ada','khazar') AND "scheduled" = true
ON CONFLICT ("id") DO NOTHING;
