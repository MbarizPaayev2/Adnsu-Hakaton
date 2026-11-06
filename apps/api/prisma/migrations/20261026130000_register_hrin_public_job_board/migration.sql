-- HRIN is a public job board, not an employer-owned source. Only its robots-allowed
-- first-page listing and public JobPosting detail pages are collected. Terms and
-- redistribution/attribution review remain pending; scheduling is intentionally off.
INSERT INTO "JobSource" ("key", "name", "employer", "homepageUrl", "collectionMethod", "scope", "accessReview", "accessNote", "applicationMethods", "enabled", "scheduled", "updatedAt")
VALUES (
  'hrin', 'HRIN.az', NULL, 'https://hrin.az/vakansiyalar', 'robots-allowed-public-listing-and-jsonld-detail',
  'Bounded first-page public job listings and matching JobPosting detail pages only; no /api, profile, employer dashboard, or applicant data',
  'ROBOTS_ALLOWED_TERMS_PENDING',
  'robots.txt allows /vakansiyalar and /vakansiya/* and disallows /api, /profil, /muracietlerim, /isegoturen, and /admin (checked 2026-10-26). Terms/republishing review remains pending. Current HTML exposes one bounded page; pagination and full active census are unverified, so the collector never infers closures. Manual run only until access review is complete.',
  ARRAY['EXTERNAL_SITE','EMAIL']::"ApplicationMethod"[], true, false, CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
