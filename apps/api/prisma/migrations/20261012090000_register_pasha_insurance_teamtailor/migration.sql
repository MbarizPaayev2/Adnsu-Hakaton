-- PASHA Insurance's career site is a Teamtailor site (verified: the official pasha-insurance.az links to
-- career.pasha-insurance.az). The earlier Workable guess stays removed; this registers the correct, verified contract
-- (the public RSS feed) under the same key. Additive: one row is upserted; no other source changes.
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","updatedAt")
VALUES ('pasha-insurance','PASHA Insurance (Teamtailor)','pasha-insurance','https://career.pasha-insurance.az/jobs','public-teamtailor-rss-feed','Public RSS feed of the employer''s own Teamtailor career site; postings with a stated Azerbaijani location only','ROBOTS_ALLOWED_TERMS_PENDING','Verified: official site links to the Teamtailor career site. robots.txt allows /jobs.rss. Attribution not reviewed.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name", "employer" = EXCLUDED."employer", "homepageUrl" = EXCLUDED."homepageUrl", "collectionMethod" = EXCLUDED."collectionMethod",
  "scope" = EXCLUDED."scope", "accessReview" = EXCLUDED."accessReview", "accessNote" = EXCLUDED."accessNote", "enabled" = true, "updatedAt" = CURRENT_TIMESTAMP;
