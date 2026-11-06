# Original-employer vacancy coverage, observed-company pages and measured reporting — 4 October 2026

Backend checkpoint 5. Nothing was imported into any production or shared database; the live checks below were read-only, robots-respecting and paced. The eJob and JobSearch holds (no written permission) are unchanged, and no access control, CAPTCHA or crawler rule was bypassed.

## 1. Employer-verified ATS tenants
`src/scrapers/public-jobs/ats-tenants.ts` (new) is the single place that says what "verified" means: a tenant is the employer's own only when the employer's **official** page links to *that vendor and that tenant* (a shared vendor host such as `apply.workable.com` proves nothing by itself — the AccessBank/Nigerian-bank mistake is a test case). It also recognises ATS vendors in links on an official career page (Workable, Teamtailor, SAP SuccessFactors, Greenhouse, Lever, Recruitee, SmartRecruiters, BambooHR, Workday, Oracle Cloud) so a new lead is *found*, not guessed. Detecting a vendor registers nothing: a collector, a source row and a review are still required. `collectorTenants()` lists every tenant a collector exists for; a spec proves each is tied to an `official-career-link-checked` employer entry whose career URL is on the tenant host, and that quarantined candidates have no collector.

Live re-verification (read-only `npm`-style script `src/scripts/verify-ats-tenants.ts`: one robots.txt and one page per tenant, 2 s apart, at most one extra hop through career links the official page itself offers; run 3 October 2026 evening Baku):

| Tenant | Result |
|---|---|
| azercell, ey, halliburton (SAP) | official page links to the tenant directly |
| pasha-insurance (Teamtailor) | official page links to the tenant directly |
| socar (SAP) | linked one hop away: `socar.az` → `socar.jobs` career page → `jobs.socar.az` (the SOCAR domain chain changed since the first verification; the portal is still live: 32 results) |
| pasha-holding (Workable) | **not found within one hop of the career landing page**; the link exists on individual vacancy pages of the official site (checked by hand: `…/vacancies/audit-manager-pasha-holding/` links to `apply.workable.com/pasha-holding/j/BDD973568D`). Recorded as verified, but the checker should be extended to follow vacancy detail links. |

New tenants found this session: **none**. A bounded run of the repository's discovery audit on the unresolved employers found no Azerbaijan-specific ATS tenant: Deloitte, BCG and Bain expose only global career sites (reachable, robots allowed); Kapital Bank, KPMG and AccessBank need a manual robots/access review (`unrecognized`/`unknown`); McKinsey's request failed; Unibank's recorded career URL returns 404. None was registered. The registry is not being inflated toward any target.

## 2. Completeness, freshness, resumability and closure safety (verified, mostly pre-existing)
* A run is `complete` only when the collector walked the whole listing with no failures. Bounded, failed, ambiguous or shrunken (< 50 % of the previous complete listing) runs close nothing; a posting closes only after two consecutive complete listings lack it (`CLOSE_AFTER_COMPLETE_MISSES`, `MIN_LISTED_SHARE_FOR_CLOSURE`; e2e-covered by `new-public-sources`, `source-registry`, `original-sources-isolation`).
* Resumability: collectors skip detail pages of postings already stored (`isKnown`, `--skip-known-file`), so repeated bounded runs progress through the unknown remainder instead of refetching the same pages.
* Conservative deduplication is unchanged (cross-source repeats are linked, never deleted or merged, and only when company, title, day and text are essentially identical).
* **New: honest freshness in the coverage model.** Each source now reports `completeness` (`verified_complete` / `bounded_or_partial` / `failed` / `never_run` — never inferred from "zero failures"), the last run's `discovered / pages / accepted / rejected / expired / failed`, and splits open postings into `openVerifiedInCompleteListing` (seen at or after the start of the source's latest successful complete run) and `openFreshnessUnknown` (no such proof — not "closed", not "known open"). `coverageSummary` totals them (they sum to `openPostings`) next to `duplicateLinked`.
* The `report-source-coverage` script names its environment (host:port/database, no credentials), says whether it is a disposable/isolated inventory (local host and a test/trial/census/scratch/local-preview name) or must be treated as production-like, and never adds numbers across databases.

### Measured inventory (read-only, 3–4 October 2026)
| Inventory | Open postings | Proven listed by a verified-complete run | Freshness unknown | Duplicate-linked (excluded) | Explicit e-mail application |
|---|---|---|---|---|---|
| `aise_census` (isolated, imports of 2 October) | **1,391** | **154** (employer ATS: ABB 56, SOCAR 32, PASHA Insurance 35, Azercell 14, Yelo 9, PASHA Holding 5, PwC 2, Halliburton 1) | **1,237** (hellojob 543, boss 399, smartjob 283, work 12) | 48 | 222 |
| `aise_phase2_test` (isolated test database) | 0 | 0 | 0 | 0 | 0 |

The job-board sources (hellojob, boss, smartjob, work) are bounded snapshots whose last recorded run was not a verified-complete one, so none of their postings is proven current. The production inventory was **not** measured in this work and is not mixed into these figures. Nothing here supports a claim near 5,000.

## 3. Public pages for observed companies
Employers named by imported postings now have public pages that are explicitly **not** registered AISE employers (`registered: false`, a plain attribution statement, no contact details, no "verified" mark). New `GET /public/companies`, `GET /public/companies/:id`, `GET /public/companies/:id/logo` (no session).
* **Stable id** `oc_<16 hex>` derived from the normalised company name (the same normalisation cross-source dedup and company follows use), independent of row ids, import order or source; `followKey` is the key company follows already use. A company whose postings have all closed keeps its page and id (`openCount: 0`) and is simply not listed.
* **Accurate counts.** `openCount` = distinct postings that are active, not hidden, not a cross-source repeat and not past their deadline. `totals.openPostings` reconciles with the postings table (tested), and postings whose company has no usable name are reported separately (`postingsWithoutUsableCompanyName`) instead of being merged under one fake company.
* **Attribution.** Every page lists the sources its postings were collected from (name, homepage, count) and every job links to the AISE detail route and carries `checkedAt` (last import that listed it); the original posting link and apply route remain on the job detail.
* **Logo provenance, monogram fallback.** A logo is shown only when file, source (`employer_website | source_listing | operator_upload`), the public page it was taken from and a verification time are all recorded (`ObservedCompanyProfile`, migration `20261017110000`); otherwise `logo` is null and the page gets a deterministic monogram (`{text, color}`). Logos are stored copies served by the logo route (magic-byte checked as PNG/JPEG/WEBP, `nosniff`; a stored file that is not an image is 404), never hot-linked. An operator records a logo with `src/scripts/set-observed-company-logo.ts` (dry run by default; requires the source and source page). **No logo has been collected for any company**: collecting them needs per-employer review and was not done.
* Scraped companies are never auto-registered and are never matched to a registered employer by name.

## 4. Verification
Unit: observed-company identity/monogram/grouping, logo script arguments and image checks, ATS vendor detection and ownership (shared-host false positive covered), employer-registry ↔ collector invariants. `test/observed-companies.e2e-spec.ts` (6 tests, isolated Postgres): exact counting (closed/hidden/expired/duplicate excluded), reconciliation with the table, stable id across closure and reopening, 404/400 handling, logo provenance gating and non-image refusal, coverage completeness states (never run → bounded → failed-detail "complete" → verified complete → failed), environment labelling. The existing source/ingestion e2e suites (`original-sources-isolation`, `source-registry`) still pass.

## 5. Not done / honest limits
* No new employer or ATS source was added; no logos collected; Work.az "load more" discovery, eJob/JobSearch permission and the production inventory measurement remain open (see `docs/scraper-integration-2026-10-03.md`).
* The tenant checker follows one hop; vacancy-detail-level links (PASHA Holding) need a second hop.
* Company identity is by normalised name: two different employers with the same name would share a page, and a renamed employer gets a new id.
