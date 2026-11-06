-- Official careers.bp.com links this exact Workday tenant. Verified 25 October 2026.
-- Public /wday/cxs search/detail paths are allowed by robots; /bpCareers/ candidate pages
-- are disallowed and never fetched. Original candidate-facing links are retained.
-- An access review is not a republication licence. Pause/remove on request.
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","intervalMinutes","nextRunAt","updatedAt")
VALUES ('bp-azerbaijan','bp Azerbaijan careers (Workday)','bp Azerbaijan','https://careers.bp.com/','public-workday-cxs-json','Only postings whose Workday country is explicitly Azerbaijan',
 'ROBOTS_ALLOWED_TERMS_PENDING','Verified 25 October 2026: careers.bp.com/job-description/RQ117127 links this exact Workday tenant. robots does not restrict public /wday/cxs; disallowed /bpCareers/ pages, login and apply routes are never fetched. No reuse licence claimed; pause/remove on request.',
 ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,true,1440,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "AdminAuditLog" ("id","adminUserId","action","targetType","targetId","metadata","createdAt")
SELECT 'mig20261108-bp-azerbaijan',NULL,'SOURCE_SCHEDULE_CHANGED','JobSource',"key",
 jsonb_build_object('scheduled',true,'intervalMinutes',1440,'actor','release migration 20261108090000','basis','founder authorization for vacancy coverage expansion, 25 October 2026'),CURRENT_TIMESTAMP
FROM "JobSource" WHERE "key" = 'bp-azerbaijan' AND "scheduled" = true
ON CONFLICT ("id") DO NOTHING;
