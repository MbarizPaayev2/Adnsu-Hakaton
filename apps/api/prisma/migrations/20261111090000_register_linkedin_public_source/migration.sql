-- LinkedIn public guest job listings for Azerbaijan.
-- Public guest search endpoint and public JobPosting structured data only.
-- Keep disabled and unscheduled until terms/access review is complete.
-- Direct public reads only; blocks/authwalls are respected, never routed through a proxy.
-- Pause, hide or remove on employer/platform request.
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","intervalMinutes","nextRunAt","updatedAt")
VALUES ('linkedin','LinkedIn Azerbaijan public vacancies','LinkedIn','https://www.linkedin.com/jobs/search?location=Azerbaijan','public-html-list-and-detail','Publicly listed Azerbaijan roles only; guest search and JobPosting structured data; no login bypass; closures not inferred','ROBOTS_ALLOWED_TERMS_PENDING','Not scheduled while terms/access review is pending. Direct public reads only; blocks/authwalls end the request. Pause or remove on request.','{EXTERNAL_SITE}'::"ApplicationMethod"[],false,false,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name", "employer" = EXCLUDED."employer", "homepageUrl" = EXCLUDED."homepageUrl",
  "collectionMethod" = EXCLUDED."collectionMethod", "scope" = EXCLUDED."scope", "accessReview" = EXCLUDED."accessReview",
  "accessNote" = EXCLUDED."accessNote", "applicationMethods" = EXCLUDED."applicationMethods",
  "enabled" = false, "scheduled" = false, "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "AdminAuditLog" ("id","adminUserId","action","targetType","targetId","metadata","createdAt")
VALUES ('mig20261111-linkedin',NULL,'SOURCE_SCHEDULE_CHANGED','JobSource','linkedin',
  jsonb_build_object('enabled',false,'scheduled',false,'accessReview','ROBOTS_ALLOWED_TERMS_PENDING','actor','release migration 20261111090000','basis','terms/access review is pending; do not collect until reviewed'),CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
