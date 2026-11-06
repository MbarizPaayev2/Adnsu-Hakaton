-- Reviewed official employer sources found by the 16 October 2026 acquisition probe (docs/vacancy-acquisition-2026-10-16.md).
-- Both are the employer's own public pages; attribution and the original application destination are kept. No account, apply or form endpoint is requested.
-- No commercial republication licence is claimed: access review stays ROBOTS_ALLOWED_TERMS_PENDING; pause or remove on request.
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","intervalMinutes","nextRunAt","updatedAt")
VALUES
('irshad','İrşad careers','İrşad Electronics','https://irshad.az/az/sirket/vakansiyalar','public-employer-html','Current branch vacancies with the towns each posting names; single unpaginated list','ROBOTS_ALLOWED_TERMS_PENDING','Reviewed 16 October: robots allows the career pages and asks for a 30 s crawl delay (honoured); published terms concern purchases, no automation clause found. No reuse licence claimed; pause or remove on request.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('baker-hughes','Baker Hughes careers (Workday)','Baker Hughes','https://bakerhughes.wd5.myworkdayjobs.com/BakerHughes','public-workday-cxs-json','Azerbaijan postings on the official Workday career site; only postings Workday files under Azerbaijan','ROBOTS_ALLOWED_TERMS_PENDING','Reviewed 16 October: careers.bakerhughes.com links this Workday site; its robots allows /BakerHughes/ and does not restrict /wday/cxs. No reuse licence claimed; pause or remove on request.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "AdminAuditLog" ("id","adminUserId","action","targetType","targetId","metadata","createdAt")
SELECT 'mig20261031-' || "key",NULL,'SOURCE_SCHEDULE_CHANGED','JobSource',"key",
 jsonb_build_object('scheduled',true,'intervalMinutes',1440,'actor','release migration 20261031090000','basis','founder authorization for autonomous vacancy acquisition, 16 October 2026'),CURRENT_TIMESTAMP
FROM "JobSource" WHERE "key" IN ('irshad','baker-hughes') AND "scheduled" = true
ON CONFLICT ("id") DO NOTHING;
