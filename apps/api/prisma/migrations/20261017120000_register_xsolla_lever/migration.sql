-- Xsolla's career site is hosted on Lever (verified: official xsolla.com/careers links to jobs.lever.co/xsolla).
-- Registers Xsolla as a verified original employer source using the public Lever JSON API.
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","updatedAt")
VALUES ('xsolla','Xsolla (Lever)','xsolla','https://jobs.lever.co/xsolla','public-lever-json-api','Public Lever JSON feed for Xsolla; postings with a stated Azerbaijani location only','ROBOTS_ALLOWED_TERMS_PENDING','Verified: official site links to Lever career site. robots.txt allows / with 1s crawl-delay. Attribution not reviewed.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name", "employer" = EXCLUDED."employer", "homepageUrl" = EXCLUDED."homepageUrl", "collectionMethod" = EXCLUDED."collectionMethod",
  "scope" = EXCLUDED."scope", "accessReview" = EXCLUDED."accessReview", "accessNote" = EXCLUDED."accessNote", "enabled" = true, "updatedAt" = CURRENT_TIMESTAMP;
