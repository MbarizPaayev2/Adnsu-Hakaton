-- NORM (cement and building materials): the employer's own careers page lists every open vacancy with the application instruction
-- ("CV-ni … hr@norm.az ünvanına göndərin"), the posting date and the deadline. First manufacturing source with an e-mail route.
-- Scheduled daily under the founder's standing authorization for official employer sources. Additive and reversible (pause in admin → Mənbələr).
-- robots.txt: "User-agent: *  Disallow:" (everything allowed). The server sends the wrong intermediate certificate; the collector adds the one
-- missing public DigiCert intermediate for this host only and still verifies the chain and the host name.
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","intervalMinutes","nextRunAt","updatedAt")
VALUES ('norm','NORM careers','NORM','https://www.norm.az/page/careers','public-html-accordion-with-application-instructions','Open vacancies on the company''s own careers page; Azerbaijan','ROBOTS_ALLOWED_TERMS_PENDING','robots.txt allows everything (empty Disallow). Employer-owned page. Attribution not reviewed; pause, hide or remove on request.',ARRAY['EMAIL','EXTERNAL_SITE']::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "enabled" = true, "scheduled" = true, "nextRunAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "AdminAuditLog" ("id","adminUserId","action","targetType","targetId","metadata","createdAt")
SELECT 'mig20261026-' || "key", NULL, 'SOURCE_SCHEDULE_CHANGED', 'JobSource', "key",
       jsonb_build_object('scheduled', true, 'intervalMinutes', 1440, 'actor', 'release migration 20261026090000', 'basis', 'standing authorization for official employer sources'),
       CURRENT_TIMESTAMP
FROM "JobSource" WHERE "key" = 'norm' AND "scheduled" = true
ON CONFLICT ("id") DO NOTHING;
