-- Register expanded public job sources: smartjob, boss, work
INSERT INTO "JobSource" ("key","name","employer","homepageUrl","collectionMethod","scope","accessReview","accessNote","applicationMethods","enabled","scheduled","updatedAt")
VALUES
 ('smartjob','Smartjob',NULL,'https://smartjob.az/vakansiyalar','public-html-and-sitemap+jobposting-metadata','Public vacancy listings and sitemap; no CV/candidate accounts','ROBOTS_ALLOWED_TERMS_PENDING','Robots allows access. Host directive accepted. Attribution/terms not reviewed.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP),
 ('boss','Boss.az',NULL,'https://boss.az/search/vacancies','public-search-and-apollo-ssr-metadata','Public vacancies search and category pages; direct email application evidence preserved','ROBOTS_ALLOWED_TERMS_PENDING','Robots allows /search/* and /vacancies/*. Attribution/terms not reviewed.',ARRAY['EMAIL','EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP),
 ('work','Work.az',NULL,'https://www.work.az/vakansiyalar','public-sitemap-and-jobposting-metadata','Public vacancy sitemap and detail pages; no candidate accounts','ROBOTS_ALLOWED_TERMS_PENDING','Robots allows access. Terms state employer liability. Attribution not reviewed.',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
