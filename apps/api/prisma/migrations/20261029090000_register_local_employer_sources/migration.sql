-- Reviewed official employer public vacancy pages, authorized in the 13 October coverage brief.
-- Attribution and the original application destination are preserved. No account or submission endpoint is collected.
-- Robots permit the paths (Veyseloglu has a genuine 404 for robots.txt); no published automation restriction was found.
-- No commercial republication licence is claimed: access review remains ROBOTS_ALLOWED_TERMS_PENDING.
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","intervalMinutes","nextRunAt","updatedAt")
VALUES
('avrora','Avrora careers','Avrora','https://www.avrora.az/az/karyera','public-employer-html','Active employer vacancies, explicit application instructions only','ROBOTS_ALLOWED_TERMS_PENDING','Reviewed 13 October: career paths allowed by robots; privacy policy concerns candidate data. No reuse licence claimed; pause or remove on request.',ARRAY['EMAIL','EXTERNAL_SITE']::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('azergold','AzerGold careers','AzerGold','https://careers.azergold.az/vacancies','public-employer-html','Official vacancies with full dated deadlines and source locations','ROBOTS_ALLOWED_TERMS_PENDING','Reviewed 13 October: robots allows public vacancy pages; privacy policy concerns candidate data. No reuse licence claimed; pause or remove on request.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('veyseloglu','Veyseloglu MMC careers','Veyseloglu MMC','https://karyera.veyseloglu.az/home/allvacancies?pageIndex=1&pageSize=5','public-employer-html','Current paginated employer list only; undated years retained as text without guessing','ROBOTS_ALLOWED_TERMS_PENDING','Official corporate press release links the career portal; genuine robots 404. No automation restriction found and no reuse licence claimed; pause or remove on request.',ARRAY['EMAIL','EXTERNAL_SITE']::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "AdminAuditLog" ("id","adminUserId","action","targetType","targetId","metadata","createdAt")
SELECT 'mig20261029-' || "key",NULL,'SOURCE_SCHEDULE_CHANGED','JobSource',"key",
 jsonb_build_object('scheduled',true,'intervalMinutes',1440,'actor','release migration 20261029090000','basis','founder authorization for vacancy coverage expansion'),CURRENT_TIMESTAMP
FROM "JobSource" WHERE "key" IN ('avrora','azergold','veyseloglu') AND "scheduled" = true
ON CONFLICT ("id") DO NOTHING;
