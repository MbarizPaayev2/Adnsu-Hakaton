-- KPMG Caucasus and Central Asia's public Huntflow board lists Baku roles.
-- It is not linked from KPMG Azerbaijan's local vacancies page, so we label
-- it as the regional board and retain a pending terms/reuse review.
-- Collection is Baku-only, rate-limited, never enters apply/login paths, and
-- never infers closures because the board's "show more" pagination is not yet
-- traversed. No commercial reuse licence is claimed; pause/remove on request.
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","intervalMinutes","nextRunAt","updatedAt")
VALUES ('kpmg-cca','KPMG Caucasus and Central Asia public careers board','KPMG Caucasus and Central Asia','https://kpmgcca.global.huntflow.io/','public-html-list-and-detail','Only publicly listed Baku/Bakı roles; initial listing snapshot only, no closure reconciliation','ROBOTS_ALLOWED_TERMS_PENDING','Public KPMG CCA-branded board; robots permits public vacancy paths. No official link from KPMG Azerbaijan local careers page or republication licence verified. Public listings only; no login/apply paths; Baku-only and no inferred closures. Pause or remove on request.','{EXTERNAL_SITE}'::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name", "employer" = EXCLUDED."employer", "homepageUrl" = EXCLUDED."homepageUrl",
  "collectionMethod" = EXCLUDED."collectionMethod", "scope" = EXCLUDED."scope", "accessReview" = EXCLUDED."accessReview",
  "accessNote" = EXCLUDED."accessNote", "applicationMethods" = EXCLUDED."applicationMethods";

INSERT INTO "AdminAuditLog" ("id","adminUserId","action","targetType","targetId","metadata","createdAt")
VALUES ('mig20261110-kpmg-cca',NULL,'SOURCE_SCHEDULE_CHANGED','JobSource','kpmg-cca',
  jsonb_build_object('scheduled',true,'intervalMinutes',1440,'actor','release migration 20261110090000','basis','founder authorization to expand public Azerbaijan vacancy coverage; conservative regional-board scope'),CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
