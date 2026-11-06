-- Reviewed official specialized financial job board for Azerbaijan: Banker.az.
-- banker: https://banker.az/vakansiyalar/
-- Covers licensed banking, BOKT, credit organization, lombard, and fintech vacancies across Azerbaijan.
-- Direct employer recruitment emails are provided for the vast majority of postings (e.g. hr@caspianinvest.az, vakansiya@icu.az, mehin.a@akgroup.az).
-- Registration only: this migration does not establish access permission or reuse rights.
-- Application routes remain EXTERNAL_SITE globally; a per-posting email requires explicit application instructions.
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","intervalMinutes","nextRunAt","updatedAt")
VALUES
('banker','Banker.az Vacancies','Banker.az','https://banker.az/vakansiyalar/','public-board-html','Specialized financial job board; Azerbaijan location and posting dates are taken from individual listing evidence','ROBOTS_ALLOWED_TERMS_PENDING','Robots permits access. Terms and reuse review remain pending; source is registered disabled and unscheduled until explicit access review. Application email is derived per posting only when the posting contains an application instruction.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],false,false,720,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
