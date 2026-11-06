-- Reviewed official career portal for Azerbaijan Supermarket LLC (Bravo Supermarket).
-- bravo: official portal at https://www.bravosupermarket.az/career/all-vacancies/.
-- Covers head office roles, store management, and regional branch operations.
-- Registration only: this migration does not establish access permission or reuse rights.
-- Application routes remain EXTERNAL_SITE globally; a per-posting email requires explicit application instructions.
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","intervalMinutes","nextRunAt","updatedAt")
VALUES
('bravo','Bravo Supermarket Careers','Bravo','https://www.bravosupermarket.az/career/all-vacancies/','public-employer-html','Official Bravo careers portal; listing scope and location facts require source verification','ROBOTS_ALLOWED_TERMS_PENDING','Robots permits access. Terms and reuse review remain pending; source is registered disabled and unscheduled pending an explicit access review. Do not infer a specific city from category or hidden comment text.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],false,false,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
