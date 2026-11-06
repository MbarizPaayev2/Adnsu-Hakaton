# LinkedIn Vacancy and URL Extraction — 2026-10-27

## Objective & Background
Enable candidate-requested extraction of public LinkedIn vacancy URLs and evaluate public listing discovery. The collector remains disabled until LinkedIn access/terms review is complete. Direct reads stop at authwalls, bot blocks, or rate limits; the service does not use a proxy to get around them.

---

## 1. Architectural & Technical Implementation

### 1.1 Single Vacancy URL Extraction & Validation (`linkedin-job.parser.ts`)
- **Strict URL & Format Validation (`validateLinkedInJobUrl`)**:
  - Accepts canonical format: `https://www.linkedin.com/jobs/view/<jobId>`, regional `https://az.linkedin.com/jobs/view/<jobId>`, and title-slugged formats `https://www.linkedin.com/jobs/view/<slug>-<jobId>?...`.
  - Allows only `linkedin.com`, `www.linkedin.com`, and `az.linkedin.com`; rejects other hosts, non-standard ports, embedded credentials, and invalid paths. It extracts the canonical numeric requisition ID (`jobId`).
  - Canonicalizes to `https://www.linkedin.com/jobs/view/<jobId>`.
- **High-Fidelity Parser (`parseLinkedInJobDetail`)**:
  - Priority 1: Reads Schema.org `JobPosting` structured JSON-LD (`<script type="application/ld+json">`):
    - `title`, `hiringOrganization.name`, `datePosted`, `validThrough` (deadline), `employmentType`.
    - HTML `description` formatted and sanitized into clean readable text preserving paragraphs and bullet lists using Cheerio.
  - Priority 2: Semantic DOM Fallbacks when JSON-LD is omitted or stripped:
    - Title from `h1.top-card-layout__title` / `h1.topcard__title`.
    - Company from `a.topcard__org-name-link` / `.topcard__flavor--first-link`.
    - Location from `span.topcard__flavor--bullet` / `.job-search-card__location`.
    - Description from `.show-more-less-html__markup` / `.description__text`.
  - **Quality Gates**:
    - **Azerbaijan Location Enforcement**: Strictly verifies location (Baku, Sumgayit, Ganja, etc., or Country `AZ`/`Azerbaijan`). Explicitly rejects foreign listings (e.g. London, Berlin, Dubai).
    - **Closure Detection (`isLinkedInJobClosed`)**: Detects "No longer accepting applications", "This job is closed", and "Bu vakansiya artıq aktiv deyil" banners, preventing the ingestion of stale/ghost jobs.
    - **Date Guards**: Rejects publication dates placed > 24 hours in the future.

### 1.2 Direct Retrieval Service (`linkedin-job.service.ts`)
- **Direct Retrieval**:
  - The fetch implementation exists but is hard-disabled unless `LINKEDIN_URL_READ_APPROVED=true` is explicitly configured after an access/legal review. No production request is made while this gate is absent.
  - When explicitly approved, it would use direct requests and bounded redirect tracking (max 3 redirects).
  - Handles redirects to `/authwall`, `/login`, or `/checkpoint`.
- **Access boundary**:
  - Authwall, 401, 403, 429, 999 and fetch errors end the attempt with an Azerbaijani recovery message. No third-party reader proxy is used.
  - Direct fetch enforces a 4MB streaming response limit and 15-second timeout.
- **Service API**:
  - `extractLinkedInJob(url, options)` returns `{ job: IngestJobDto, method: 'direct' }`.

### 1.3 LinkedIn Azerbaijan Jobs Collector (`linkedin.collector.ts`)
- Implements `LinkedInCollector` adhering to AISE's standard collector interface:
  - The collector code can parse a guest search response, but must remain disabled: LinkedIn's robots.txt disallows `/jobs-guest/`, and the User Agreement restricts unapproved automated collection.
- The collector additionally returns without network calls unless `LINKEDIN_COLLECTION_APPROVED=true`; production must also keep its source row disabled until the recorded access review authorizes a specific scope.
  - It was originally implemented against LinkedIn's public guest search carousel:
    `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?location=Azerbaijan&geoId=100378370&start=${start}`
  - Parses card links, URNs (`urn:li:jobPosting:<id>`), titles, companies, locations, and list dates. Cards with unknown locations remain unknown; unknown is never converted to Baku.
  - Skips already known postings (`isKnown`), tracks `discovered`, `fetched`, `accepted`, `failed`, `expired`.
  - Supports resume cursors (`cursor: { kind: 'cursor', value: 'linkedin:<id>' }`) and bounded execution budgets. It refuses to restart at page one when the cursor item is no longer present.
  - Enforces a 2,000ms minimum inter-request delay.

### 1.4 System & Registry Integrations
- Registered in `apps/api/src/scrapers/public-jobs/collector-registry.ts`:
  - Added to `COLLECTOR_KEYS`.
  - Handled in `collectorFor('linkedin')`.
- Registered in `apps/api/src/jobs/source-discovery.ts`:
  - Added to `BOARD_SOURCES`.
- API Endpoints Exposed:
  - `@Post('extract-url')` in `JobsController` (`/internal/jobs/extract-url`, guarded by `ApiKeyGuard`).
  - `@Post('extract-url')` in `JobCatalogueController` (`/jobs/extract-url`, guarded by `SessionAuthGuard`).
- Prisma Migration:
  - `20261111090000_register_linkedin_public_source`: Inserts `linkedin` into `"JobSource"` with `accessReview: 'ROBOTS_ALLOWED_TERMS_PENDING'`, `enabled=false`, `scheduled=false` and audit trail. Terms/access review is a prerequisite to enabling collection.

---

## 2. Test Evidence & Verification

All tests run locally in isolated test environments:

1. `linkedin-job.parser.spec.ts`:
   - 12/12 tests passed after review fixes (URL normalization and host allowlist, search listing, unknown-location rejection, JSON-LD extraction, DOM fallback, conflicting/foreign location rejection, closure detection, future date rejection).
2. `linkedin-job.service.spec.ts`:
   - 8/8 tests passed: direct fetch, four block statuses, authwall stop behavior without proxy calls, complete extraction, and 404 handling.
3. `linkedin.collector.spec.ts`:
   - 5/5 tests passed (guest search collection, known skip, stale cursor stop, expired rejection, collector registry and BOARD_SOURCES integration).
4. `ats-tenants.spec.ts`:
   - 17/17 tests passed.
5. `import-public-jobs.spec.ts`:
   - 36/36 tests passed (includes `linkedin` preview permission check).
6. Total Public-Jobs Suite:
   - Existing PR-wide public-jobs results were from before the review fixes. Current focused LinkedIn suites: 3/3 suites, 25/25 tests passed.
7. TypeScript Build:
   - `nest build` for `apps/api` passed with 0 errors.

---

## 3. Review Notes / Evidence Limits
No GitHub push was performed. The reviewed changes remain local on `codex/linkedin-job-extraction` for independent review.

Fixture tests and the local build do not prove that live LinkedIn pages are consistently available or that scheduled collection is permitted. Keep the source disabled. See `linkedin-terms-and-access-governance.md` for the current decision, user-paste fallback, and the conditions for any later authorized integration.
