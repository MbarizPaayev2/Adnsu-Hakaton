-- Reviewed official sources from the 16 October 2026 reusable-job-system probe (docs/vacancy-acquisition-2026-10-16.md, section 5b).
-- fairmont-baku: Accor's careers site filtered to its Baku location facet, linked from Fairmont Baku's official page; each posting's employer is the hotel it names.
-- stp: the STP group's own career portal, linked from stp.az. Attribution and the original application destination are kept; no account, apply or form endpoint is requested.
-- No commercial republication licence is claimed: access review stays ROBOTS_ALLOWED_TERMS_PENDING; pause or remove on request.
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","intervalMinutes","nextRunAt","updatedAt")
VALUES
('fairmont-baku','Accor careers (Baku)','Fairmont Baku','https://careers.accor.com/global/en/jobs?options=313&page=1','public-employer-html','Current Accor hotel vacancies in Baku (location facet 313); complete only when the stated total is listed','ROBOTS_ALLOWED_TERMS_PENDING','Reviewed 16 October: fairmont.com links careers.accor.com; robots allows / and disallows only root /jobs?* and account paths. Applications go to the employer''s SmartRecruiters page. Terms of service read 16 October: no clause on automated access or reuse of job content. No reuse licence claimed; pause or remove on request.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('stp','STP career portal','STP','https://www.stpcareer.com/vakansiyalar','public-employer-html','Current vacancies of the STP group companies (Sumqayıt technology park); single list with a stated count','ROBOTS_ALLOWED_TERMS_PENDING','Reviewed 16 October: stp.az links stpcareer.com; robots has no restrictions. Applying needs an account on the portal (not used). No terms of use are published on stpcareer.com or stp.az. No reuse licence claimed; pause or remove on request.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "AdminAuditLog" ("id","adminUserId","action","targetType","targetId","metadata","createdAt")
SELECT 'mig20261101-' || "key",NULL,'SOURCE_SCHEDULE_CHANGED','JobSource',"key",
 jsonb_build_object('scheduled',true,'intervalMinutes',1440,'actor','release migration 20261101090000','basis','founder authorization for autonomous vacancy acquisition, 16 October 2026'),CURRENT_TIMESTAMP
FROM "JobSource" WHERE "key" IN ('fairmont-baku','stp') AND "scheduled" = true
ON CONFLICT ("id") DO NOTHING;
