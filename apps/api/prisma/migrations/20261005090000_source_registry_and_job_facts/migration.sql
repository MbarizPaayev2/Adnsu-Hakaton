-- Additive only: new enums/table, nullable or defaulted columns, and a seed of
-- the sources that already have reviewed collectors. Existing postings keep
-- their lifecycle; the fact columns are filled from payload fields already
-- stored with each posting (idempotent; unknown stays NULL).
CREATE TYPE "ApplicationMethod" AS ENUM ('EMAIL', 'ONLINE_FORM', 'EXTERNAL_SITE', 'UNKNOWN');
CREATE TYPE "SourceAccessReview" AS ENUM ('UNREVIEWED', 'ROBOTS_ALLOWED_TERMS_PENDING', 'TERMS_REVIEWED_ALLOWED', 'RESTRICTED');

ALTER TABLE "Job" ADD COLUMN "workArrangement" TEXT;
ALTER TABLE "Job" ADD COLUMN "experienceLevel" TEXT;
ALTER TABLE "Job" ADD COLUMN "applicationMethod" "ApplicationMethod" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Job" ADD COLUMN "applicationEmail" TEXT;
ALTER TABLE "Job" ADD COLUMN "applicationEmailEvidence" JSONB;

ALTER TABLE "JobImportRun" ADD COLUMN "discovered" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobImportRun" ADD COLUMN "rejected" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobImportRun" ADD COLUMN "skipped" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobImportRun" ADD COLUMN "expired" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobImportRun" ADD COLUMN "closureSkipped" TEXT;

CREATE TABLE "JobSource" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employer" TEXT,
    "homepageUrl" TEXT NOT NULL,
    "collectionMethod" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "accessReview" "SourceAccessReview" NOT NULL DEFAULT 'UNREVIEWED',
    "accessNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "applicationMethods" "ApplicationMethod"[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scheduled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobSource_pkey" PRIMARY KEY ("key")
);

INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","updatedAt") VALUES
 ('glorri','Glorri',NULL,'https://glorri.az','public-json-listing+detail-pages','All public Glorri listings; hourly importer','ROBOTS_ALLOWED_TERMS_PENDING','Founder decision to keep the existing importer running; this is not Glorri''s permission or a partnership.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,true,CURRENT_TIMESTAMP),
 ('hellojob','Hellojob',NULL,'https://www.hellojob.az/vakansiyalar','public-html-listing+detail-pages','Public vacancy pages only; no CV database','ROBOTS_ALLOWED_TERMS_PENDING','Robots allows collection. Attribution/republishing arrangement not reviewed.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP),
 ('abb','ABB careers','ABB','https://careers.abb-bank.az/vakansiyalar','public-json-feed','Employer''s own public vacancy feed','ROBOTS_ALLOWED_TERMS_PENDING','Robots allows access; employer-owned page. Attribution not reviewed.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP),
 ('pwc','PwC Azerbaijan','PwC','https://jobs-cee.pwc.com/ea/en/search-results-azerbaijan','public-embedded-json+jobposting-metadata','Azerbaijan-filtered public search only','ROBOTS_ALLOWED_TERMS_PENDING','Employer-owned page. Attribution not reviewed.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP),
 ('socar','SOCAR careers','SOCAR','https://jobs.socar.az/search/','sap-careers-jobposting-microdata','Whole public search result','ROBOTS_ALLOWED_TERMS_PENDING','Employer-owned page. Attribution not reviewed.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP),
 ('azercell','Azercell careers','Azercell','https://careers.digitalecosystem.az/Azercell/search/','sap-careers-jobposting-microdata','Verified /Azercell tenant only (the ecosystem root lists other employers)','ROBOTS_ALLOWED_TERMS_PENDING','Employer-owned tenant. Attribution not reviewed.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP),
 ('ey','EY careers','EY','https://careers.ey.com/ey/search/?q=&locationsearch=Baku','sap-careers-jobposting-microdata','Baku search filter only; not EY''s other channels','ROBOTS_ALLOWED_TERMS_PENDING','Employer-owned page. Attribution not reviewed.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP),
 ('halliburton','Halliburton careers','Halliburton','https://jobs.halliburton.com/search/?q=&locationsearch=Azerbaijan','sap-careers-jobposting-microdata','Rows whose metadata explicitly names Azerbaijan','ROBOTS_ALLOWED_TERMS_PENDING','Employer-owned page. Attribution not reviewed.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Facts from structured fields Glorri already stored. NOT remote stays unknown
-- (a hybrid role is also "not remote"); unrecognised career levels stay unknown.
UPDATE "Job" SET "workArrangement" = 'Remote'
 WHERE "workArrangement" IS NULL AND "rawPayload"->>'isRemote' = 'true';
UPDATE "Job" SET "experienceLevel" = CASE "rawPayload"->>'careerLevel'
    WHEN 'career-levels.entry' THEN 'Junior'
    WHEN 'career-levels.graduate' THEN 'Junior'
    WHEN 'career-levels.associate' THEN 'Mid-level'
    WHEN 'career-levels.mid' THEN 'Mid-level'
    WHEN 'career-levels.supervisor' THEN 'Lead'
    WHEN 'career-levels.executive' THEN 'Lead'
    ELSE NULL END
 WHERE "experienceLevel" IS NULL AND "rawPayload"->>'careerLevel' IS NOT NULL;
