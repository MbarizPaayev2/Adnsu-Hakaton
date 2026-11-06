# AISE product-quality integration handoff — 27 October 2026

## Local integration state

- GitHub `main` inspected at `37c32dd04be8894d9c7a35ab9bab811122305dc4`.
- Document-quality worktree inspected at `a34324f` (`codex/document-quality-fallback-20261027`); its follow-up notes were read.
- LinkedIn vacancy worktree inspected at `5c40933` (`codex/linkedin-job-extraction`); its access-governance decision was read.
- Integrated checkout: `/Users/fizuli.050icloud.com/Projects/aise-product-quality-20261027`, branch `codex/product-quality-integration-20261027`.
- Integration preserves the document-quality scheduler and first-batch changes, then applies the LinkedIn job-source/access commits. Shared source scheduling remains structured-outcome based. LinkedIn registration and collector flags remain separate; source row disabled/unreviewed and no runtime approvals were enabled.
- Desktop checkout `/Users/fizuli.050icloud.com/Desktop/aise` was not modified. Nothing was pushed, merged, deployed, mailed, or written to production.

## What changed in this integration

- Fixed the Academy revocation regression fixture: the five active contributors and their interview events now use fixed times inside the report observation window. The failure was a timestamp race in the test (`new Date()` occurring after the service captured `asOf`); consent, contributor-count and cohort privacy logic remain unchanged.
- Completed the candidate-paste document path. Parsing remains transient and never creates a shared Job/Match. After explicit document generation, the original pasted text and candidate-corrected vacancy fields are stored on the candidate-owned Resume for review/regeneration. The candidate flow preserves blank unknown employer/location/date values, and parsing no longer guesses a year for a yearless deadline.
- Private vacancy documents can be quoted, queued, reviewed, and regenerated without a public catalogue row. The review API returns `matchId: null` and a private posting summary; cross-account retrieval remains denied. Resume requests retain the existing allowance reservation and request idempotency contract.
- Added retry-key handling to the paste UI: unchanged retry reuses the same key; editing the motivation answers, target document or language gets a new key so changed content cannot accidentally replay an older request.
- Updated LinkedIn governance documentation to distinguish transient parsing from the private copy retained only when a candidate requests a document.

## Focused verification

- Academy service, isolation, tenant guard, real PostgreSQL lifecycle, and sponsorship integration: **5 suites / 63 tests passed** against disposable local Postgres (`aise_test`, port 55432). Includes joining, scope-specific consent, report thresholds, revocation, and seat/isolation coverage.
- Candidate-paste `/documents` E2E: **25/25 passed** against disposable PostgreSQL, local Redis/BullMQ, and the loopback fake provider; the private draft completed quote → queue → review, was owner-only, and created no shared Job. No email was sent externally.
- Ranked recommendation service/controller and notifications: **3 suites / 87 tests passed**. Existing coverage exercises score ranking, closed/expired/hidden/duplicate/dismissed rules, plan quota boundaries, transactional concurrency, idempotent refresh, Baku resets, and notification deduplication. The stronger eligible match is selected first; unmet filters are rejected before quota is spent.
- Scheduler synthetic Postgres/Redis integration: **7/7 passed**. Collection outcome, scheduler policy, LinkedIn gates/parser/collector, and pasted-job parser: **7 suites / 46 tests passed**.
- Candidate document quality comparison, vacancy tailoring, and approval/revision suites: **3 suites / 29 tests passed**. PDF renderer suite: **2 suites / 15 tests passed**.
- Web candidate-paste and Academy/resume page tests: **2 files / 12 tests passed**; web TypeScript check and production Next build passed.
- API Nest build passed. Prisma schema/migrations validated against the disposable database: **83 migrations, current**. Matching rules selftest passed **30 scenarios**. `git diff --check` passed.
- The first private-document E2E attempt found missing explicit null `matchId` / private `posting` response fields and a fixture sharing Premium quota with the allowance test. Those were corrected; final E2E is green.

## Rendered document review

Six diverse candidate/vacancy pairs were compiled with Typst. Four pairs (same student across data analyst/Python developer roles and same experienced accountant across chief accountant/financial analyst roles) were rendered to PDF and visually reviewed at A4. Names and Azerbaijani glyphs render; target headlines, skill groups, and selected evidence differ by vacancy; sample CVs and letters are single-page with no observed clipping/overlap. These are deterministic/fake-provider pipeline examples, not live model editorial evidence.

Samples: `/Users/fizuli.050icloud.com/aise-preview/product-quality-review-20261027/` (PDFs and page-one PNGs).

No development provider key was configured (`GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` absent), so live Azerbaijani prose quality remains **unverified**. Generated samples use synthetic candidates and vacancies only.

## Remaining verification / risk

- The Academy browser journey was not captured in a signed-in browser at desktop/mobile sizes. Its real-Postgres service journey, consent, reporting and revocation passed; React page tests and responsive production build passed. A browser session with a synthetic authenticated owner/coach/student remains the visual check.
- No LinkedIn URL was fetched and no collector was run. URL reading remains blocked without `LINKEDIN_URL_READ_APPROVED=true`; automated collection requires its separate written-authorization gates and `TERMS_REVIEWED_ALLOWED`. No browser DOM scraping or reader-proxy fallback was introduced.
- First-batch selection and notification checks are code-level unit and isolated integration evidence, not a live scheduled production run. Live production behavior was intentionally untouched.

## Exact local heads

- Integrated upstream baseline: document branch head `a34324f` plus LinkedIn workstream commits through `5c40933`, cherry-picked without changing source access gates.
- Local commits: `6be94a6` (deterministic Academy cutoff fixture) and `82b5d3e` (private pasted-vacancy document flow).
- This report and the governance wording clarification are committed separately; the completion note gives the exact current branch `HEAD`.

## Independent integration review addendum — 27 October 2026

### Vacancy source branch review and integration

- GitHub `main` was rechecked at `37c32dd04be8894d9c7a35ab9bab811122305dc4`. The product worktree was at `808dd9afa929dba626862613d29534bc683781d5`; source-expansion worktree was at `4c81e4b5956dd4b9bbbf40a2952dc0748e8d8674`.
- Both workstreams were integrated in `/Users/fizuli.050icloud.com/Projects/aise-product-source-integration-20261027`, branch `codex/product-source-integration-20261027`. The initial integration commit is `0a4e6ab` atop product commits `808dd9a`, `82b5d3e`, and `6be94a6`. Additional fixes listed below are pending a final local commit.
- Shared collector registry, source discovery, scheduler outcomes, and migrations were resolved in the isolated integration tree. Existing LinkedIn gates remain off. No collector was run against a live source.

### Source evidence and measurement limits

An offline fixture audit was run at **2026-10-27 19:17 UTC** from the checked-in HTML snapshots. It does not represent a live fetch, active-market count, or production yield.

| Source | Fixture listing entries | Unique URLs | Listing completeness | Detail evidence inspected | Yield fields not measurable from snapshots |
|---|---:|---:|---|---|---|
| Bravo | 13 | 13 | Parser reports complete for the saved listing: expected “Bütün vakansiyalar” heading, one URL per card, and no detected pagination controls. No authoritative total is present in the fixture, so source-wide completeness is not proven. | 1 saved detail parsed; source date absent, so `postedAtBasis=first-observed`. City is taken only from visible card footer; missing footer stays unspecified. URL categories and HTML comments are not used as city evidence. | Freshly fetched, currently actionable, deduplicated against production, already-present, new-employer, and verified application-email counts. |
| Banker.az | 15 | 15 | Snapshot represents one listing page. It is not a proof of total market coverage. | 1 saved detail parsed; the inspected fixture has listing-card date and city evidence. Unknown company falls back to “İşəgötürən göstərilməyib”; missing city is not inferred as Baku. First observation is explicitly tagged and guarded from overwriting an existing source date on later ingestion. | Freshly fetched, current/actionable, remaining pages, production duplicates, new employers, and verified email routes across all postings. |

Both source migrations insert rows with `enabled=false`, `scheduled=false`, and `accessReview=ROBOTS_ALLOWED_TERMS_PENDING`, using `ON CONFLICT DO NOTHING` so existing operator settings are preserved. Global application methods are only `EXTERNAL_SITE`; an email is not a verified application route unless the posting explicitly instructs applicants to apply by email. Migration comments were corrected to avoid implying that robots permission establishes terms or reuse rights. The sources must remain disabled pending explicit access/terms review. The prior source branch’s claimed `+28` live postings / `+18` email routes was not reproduced and is not treated as verified by this review.

### Academy browser journey and fixes

Synthetic authenticated journeys were exercised against the disposable local database at desktop (1440 px) and mobile (390 px): owner dashboard, coach invitation acceptance, student join, aggregate-only consent, cohort reporting, and student revocation. Screens were visually inspected in the local browser. The Academy dashboard kept private identity hidden after revocation and showed unreported outcomes as “Hesabat verilməyib.” The mobile cohort selector was adjusted to stack and constrain width.

Review uncovered two integration bugs and one missing privacy control; fixed locally:

1. Student settings had no visible consent-revocation control despite the join-flow promise. Added `AcademyConsentSettings` with active scope/status, confirmation before revocation, loading/error/success states, and empty state; mounted it in Settings.
2. Candidate outcomes queried `/academies/my/enrollments`, which does not match the actual API route. Corrected it to `/academies/my-enrollments` and updated component mocks.
3. Fixed mobile cohort-selector overflow.

Focused Academy/product verification after these changes: Web component/page tests **3 files / 17 tests passed**; web TypeScript check passed; web production build passed. API build passed. Prior disposable-Postgres Academy journey tests passed **4 suites / 62 tests**. Earlier API Academy suite run was **5 suites / 63 tests passed** (service, isolation, tenant guard, real database lifecycle and sponsorship integration). Screenshots were captured and visually checked during the local browser session; they were not committed as repository artifacts.

### Rendered-document review

Four generated PDF page images were inspected from the existing synthetic comparisons (student applying to data analyst and Python developer roles; experienced accountant applying to chief accountant and financial analyst roles). Layout was legible, one page per document, names and Azerbaijani glyphs preserved, and target headlines/selected evidence differed between vacancies. Editorial review still finds the motivation letters too factual/generic and not sufficiently persuasive about why the role/company or the candidate’s contribution. These were deterministic/fake-provider outputs. No authorized development model key was configured, so live Azerbaijani writing quality is **unverified**; no claim of live-model validation is made.

### Verification and final scope

- Source and scheduler tests after the final parser fallback adjustment: **3 suites / 32 tests passed** (`banker.collector`, `banker.parser`, `local-employer.collector`, scheduler policy/service paths; only three test suites were matched by Jest).
- Ranked recommendation/notification focused tests: **5 suites / 126 tests passed**.
- Academy UI tests: **3 files / 17 tests passed**; Web typecheck and production build passed.
- API Nest build passed. Disposable database is current at **85 applied migrations**. Rows `banker`, `bravo`, and `linkedin` were verified disabled, unscheduled, `ROBOTS_ALLOWED_TERMS_PENDING`, and `EXTERNAL_SITE` only.
- The integration tree received a final handoff update and local commit; exact final HEAD is in the completion message. Desktop checkout remains untouched.
- Nothing was pushed, merged, deployed, mailed, or written to production. No live source-yield or live model-writing experiment was performed.

## Independent product/source review — 27 October 2026, 19:34 UTC

### Busy.az access decision

Busy.az is **not integrated or activated**. Its currently published User Agreement §4.2(b) prohibits, absent authorization, copying, automated collection (including bots/scraping), reuse, or database creation from vacancies, company information, and contact details. Robots permission, even if present, is not permission to reuse content. No written authorization was supplied or found in the reviewed artifacts. See [Busy.az User Agreement](https://busy.az/terms-and-conditions).

The source-expansion checkout’s migration was corrected locally to insert Busy as `enabled=false`, `scheduled=false`, `accessReview=ROBOTS_ALLOWED_TERMS_PENDING`, and `EXTERNAL_SITE` only; its prior false “no terms prohibit” claim and migration audit entry claiming scheduled activation were removed. This safety-corrected source branch is not applied to the integrated product tree. No live Busy crawl or yield measurement was made. The earlier reported live additions and email-route counts remain unverified and must not be used as product/coverage claims. The checked-in fixture is test input only; a page-state/contact email is not an application route without explicit vacancy instructions.

### Independent local checks

Integrated tree exact head: `76b79c4a5f89db6f244912c04b3216cfaa16cc8e`.

- API focused product suites: **5 suites / 103 tests passed** (recommendation policy/service/controller, notifications, pasted-job parser).
- API Academy / document selection: **5 suites passed, 94 tests passed, 1 database suite skipped in the initial run**; the integration suites were then run against disposable `aise_test` on `aise-source-review-db` port 55433 with its configured credentials: **2 suites / 6 tests passed**. The skipped initial suite was due to its optional sponsorship-integration environment gate; it was explicitly enabled for the disposable run.
- Web Academy/document/recommendation tests: **6 files / 50 tests passed** across two focused invocations. JSDOM emitted its expected “navigation not implemented” diagnostic from a test that exercises an external apply action; test result remained green.
- API Nest build and Web TypeScript check passed.
- Rendered synthetic document samples were visually inspected from `/Users/fizuli.050icloud.com/aise-preview/product-quality-review-20261027/`. Layout and Azerbaijani glyphs are sound; the student data-analyst letter still reads mostly as factual evidence and does not yet demonstrate compelling, candidate-confirmed company/role motivation. Treat prose quality as a product-quality follow-up, not solved by deterministic tests.
- No `GROQ_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` is configured; live-model Azerbaijani editorial quality is **unverified**. Existing Academy screenshot files are dated 26 October; the current visual journey was not recaptured in this review.

### Disposition and limits

- Do not integrate Busy collector or apply its migration without written authorization and a scoped access/reuse review. If authorization arrives, re-review source scope and terms before enabling any schedule.
- Existing integrated collectors (Bravo, Banker, LinkedIn) remain as previously reviewed; this review did not run them live. LinkedIn automatic collection remains disabled.
- No source was activated, no production data changed, and no push, merge, deployment, or email was performed. The unrelated Desktop checkout remains untouched.

## Follow-up increment — 28 October 2026

### Motivation proposal correctness

The motivation panel previously offered personal-sounding reasons based only on vacancy duties and sometimes used a second job duty as if it were a company-specific reason. That could make a candidate appear to have a preference or employer insight they had not supplied.

- Role and company proposals now contain a vacancy-anchored sentence with a clearly marked candidate-input slot. Company suggestions ask for a product, service, or project fact the candidate has personally checked; the vacancy description alone is not presented as evidence of company culture or values.
- The UI labels the content as a draft, explains which text comes from the vacancy and which must come from the candidate, and disables acceptance while any bracketed prompt remains. The candidate may edit, skip, or leave the answer blank. Existing answers remain unchanged unless they explicitly adopt an edited proposal.
- The API no longer treats a second responsibility line as a company reason. Vacancy evidence remains available to ground role and contribution suggestions.

### Verification this increment

- API focused set: **10 suites / 224 tests passed** across Academy service/isolation/tenant guard, recommendation policy and matching, pasted vacancy parser/private document selection, document quality and approval/revision. The API test command emitted expected mocked-provider warnings in fallback tests; all suites passed.
- Academy real-Postgres lifecycle: **5/5 passed** against disposable `aise_test` Postgres on `aise-source-review-db:55433`, covering join, scope consent, roster privacy, reporting threshold and revocation.
- Web focused set: **4 files / 18 tests passed** for motivation proposals, private vacancy paste, consent settings, and Academy page.
- API build, Web TypeScript check, and `git diff --check` passed.
- Previous local render review remains the evidence for synthetic CV/letter layout and Azerbaijani glyphs. This follow-up did not rerender the samples. Model keys were absent from the environment and no `.env` provider configuration was found; live model prose quality remains **unverified**.

### Source decision and scope

AzVak remains a separate proposal branch and was not copied into this product-integration checkout. Its public terms and robots evidence are summarized in `docs/azvak-independent-review-2026-10-28.md` in that worktree. Since no automated collection/reuse grant was found, the product branch does not register or schedule the source. LinkedIn automation remains disabled; no production data, external application, source activation, deployment, or production merge was performed.
