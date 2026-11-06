# MVP journey release: record, evidence and backlog (11 October 2026)

What went live, what each piece of evidence does and does not prove, and what is left. Companion records: `employer-release-2026-10-11.md`, `source-coverage-2026-10-12.md`, `ai-provider-configuration-2026-10-12.md`, `browser-agent-2026-10-10.md`.

## 1. Live now

| | |
|---|---|
| Checkout | `84108293574b529e1a1e1b2fd5bd4be876ff3897` (merge of PR #51; CI **success** on this exact commit). Includes PRs #46, #49, #50 (writer stack, merged in order) and #51 (journey and coverage batch). |
| API image | `sha256:9fd9763e4199c80b180691696c85b6d9419d29554ca7d556b2c120d2b64559c2`, revision label = the checkout, amd64, built once on the Mac, provenance PASS, streamed with `docker save | gzip | docker load`, host id identical |
| Web image | `sha256:d94af69e518f73629bab3fb692c6ad99b409792cc4acb212afa9e12c215d4ae8`, same procedure |
| Scorer / apply worker | unchanged (`sha256:82a8565cf4c9…`) |
| Migration | `20261024090000_register_kapital_schedule_yelo` (schedules two sources; 53 migrations finished, none rolled back) |
| Switches (unchanged) | `DOCUMENT_GENERATION_ENABLED=true`, `TAILOR_AZ_WRITER=true`, `EMPLOYER_PLANS_ENABLED=true`, `EMPLOYER_BILLING_ENABLED=true`, `BROWSER_AGENT_ENABLED=true` (assisted only, autonomous off), external auto-apply off |
| Verification | `verify-deployment.sh` with explicit image ids and `EXPECT_PAYMENTS/DOCUMENTS/AGENT/EMPLOYER_PLANS/EMPLOYER_BILLING=true`: all checks passed. Host `check-health.sh` after the deploy: only a disk warning (cleared by removing two old image generations, 17% free) and the backup-destination label (restored to the bucket by `offhost-sync.sh`). |
| Backup gate | set `20261011T164818Z`: off-host bucket VERIFIED; isolated restore PASSED against the schema of the code that was running (`fd3a87e`) |
| Pre-deploy provider check | the exact image in a throwaway stack with the production provider key: 41 checks passed, none failed (real provider `nvidia/nemotron-3-super-120b-a12b`, public vacancy as data, synthetic candidate) |

## 2. Roll back

```bash
# previous code (images aise-{api,web}:pre-e56e9b2967b5 = fd3a87e); the database is NOT rolled back, the migration only adds two schedule rows
RELEASE_SHA=e56e9b2967b5625513a2b859b71acabf1f04685c scripts/rollback-images.sh e56e9b2967b5 api web
# the writer alone can be switched off without a deploy (letters/CVs then use the composed path only)
scripts/host-config.sh flag TAILOR_AZ_WRITER false
```
Second level: `pre-6ecdcad5e104` (before employer plans).

## 3. What changed for candidates

* Letters are a personal explanation (reason → the experience that made it clear → strongest evidence → contribution → what caught attention); CV bullets are first person, dates are written by code. Nothing is invented: a fact the candidate did not give is asked for (`add_detail`, `reason_missing`), not made up.
* The composer has four short optional questions; saved answers are reused and shown as such (`GET /documents/letter-answers`); confirmed facts are not asked again.
* A draft that fails the checks is replaced by a **composed** letter and labelled as such (`generationMeta.outcomes`: `written`, `composed`, `polish:N/M`, `writer:*`); a rejected draft is never shown as polished.
* Telemetry records the generation path (`generator.path`, `calls`, `writerRefused`).

## 4. Evidence and its limits

| Evidence | Level | Result | Does **not** prove |
|---|---|---|---|
| API unit, web unit, typecheck, CI on the merge commit | real code, synthetic data | green | production behaviour |
| 19/19 real-browser journeys on the real API/DB/worker stack (`apps/api/test/documents-integration-journeys.ts`) | **fake provider, capture mail sink, fixture scorer — all labelled** | registration, CV upload, career entries, save/reload, quote/generate/pending/failure/review/approve/PDF, replay and allowance, cross-user refusal, e-mail subject/recipient/attachments, delivery/failure/uncertain/duplicate events | provider quality; real delivery |
| PDFs text-extracted and compared to approved letters | real renderer | 8/8 match | typography on every viewer |
| Real-provider documents journey on the exact image (throwaway stack) | real provider, synthetic candidate | 41/41 | quality at scale |
| Fresh evaluation, 4 candidate sets, NIM and Groq | real providers, rate-limited | writer accepted a minority of letters under heavy 429s; composed fallback covers the rest | native-reader approval |
| Founder review: third batch cases 2, 3, 4 accepted; case 1 not approved | the displayed examples only | recorded in `~/aise-preview/writer-quality-2026-10-11/third-review-batch/founder-feedback-2026-10-11.json` | independent native-reader approval; no score was manufactured |

**No genuine candidate has generated a document in production yet** (0 `DocumentSnapshot` rows at the time of release). No interview or hiring effect is claimed.

## 5. Vacancy coverage (measured on the host, 11 October 2026 ~17:20 UTC)

| Measure | Value |
|---|---|
| ACTIVE / CLOSED rows | 1,369 / 398 |
| ACTIVE, not hidden, not duplicate, deadline not passed ("eligible", the same rule candidates see) | 1,313 (glorri 1,097, kapital 63, abb 41, pasha 40, xsolla 39, socar 19, azercell 8, yelo 6) |
| First scheduled runs after deploy | `kapital`: complete listing, 63 created, 0 detail failures; `yelo`: complete listing, 8 created, 0 detail failures |
| New ACTIVE rows in the last 7 days / 24 hours | 434 / 94 |
| ACTIVE rows past their deadline | 54, all already hidden from candidates by the actionable rule (`isJobActionable`): Glorri 40 (deadline 10 Oct; closed by the Glorri deadline rule on its next complete hourly runs), ABB 9 (8 older than 72 h, oldest March), SOCAR 3, Azercell 2 (30 Sep). The non-Glorri collectors have no deadline rule; they close a posting only when a complete listing no longer shows it (ABB's complete run is due 12 October). |
| Vacancies with a verified application e-mail | **0** |
| ABB | first complete run with the 20-page / 300-job budget is due 12 October 11:50 UTC; the earlier runs were `PARTIAL` (`listing_incomplete`) and closed nothing |

E-mail application coverage is 0 because every collected source routes candidates to its own portal; the 49 addresses seen earlier are enquiry contacts and are **not** used. No address is guessed.

## 6. Admin and operations (read-only audit)

| Finding | Detail |
|---|---|
| Accounts | 2: founder `SUPER_ADMIN` (MFA enrolled, last login 10 Oct), former CTO `ADMIN` (no MFA, never logged in, created 2 Sep, not disabled) |
| What an `ADMIN` without MFA can do with a password | moderation, plan changes, suspensions, `ops.control`, audit read. It **cannot** refund, delete users or manage operators (those need an MFA-verified session) |
| Open sessions / pending invitations | 1 (MFA-verified) / 0 |
| Audit trail | records source-schedule changes (8, incl. the two new sources, actor null for migrations), MFA enablement, feature pause/resume, CLI recovery |
| Smallest next action | the founder disables the former CTO's account in Admin → Operators (needs the founder's MFA session). Not done by the engineer: the brief forbids deleting accounts or bypassing MFA |
| Disk | host root 83% used after removing two old image generations; shared build cache (≈24 GB reclaimable, not AISE's) waits for the founder |

## 7. Employer and browser agent

* Employer plans, billing and publication code are **unchanged** since the 11 October gates (`git diff fd3a87e..8410829` touches no file under `employers/` or `billing/`; one line in `admin-recommendations.service.ts`). The gates and their limits are in `employer-release-2026-10-11.md`; **no live employer payment has happened**.
* Browser agent: assisted mode, Lever only; code unchanged. Evidence is a fixture portal plus a real read-only page read; no real submission has been observed and none was attempted.

## 8. Decisions still open

1. Disable the former CTO's admin account (founder, MFA session).
2. E-mail application allowance by plan: today flat daily caps (10 per user, 200 global, 5 per recipient) for every plan; no vacancy has an e-mail route so nothing is lost. Decide the paid uplift before such vacancies appear.
3. Job boards (hellojob, boss, jobsearch, ejob): not scheduled, terms are silent, which is not permission.
4. Azersun, Kontakt, AZAL, BP: behind bot challenges, not collected.
5. Providers: NIM stays the default; Groq produced 0/4 and NIM 1/4 fresh letters under 429s; OpenRouter free 429; Gemini project 403. Configuration is ready (`ai-provider-configuration-2026-10-12.md`) but nothing is switched. Free Gemini must not receive real CV data.
6. Shared build cache on the host (≈24 GB reclaimable).
7. Native-reader review of the fresh review pack and third-batch case 1.

## 9. Backlog after the MVP (no new pricing tiers)

1. Require an MFA-verified session for every operator permission except `self` (one line in `permissions.ts` `NEEDS_MFA_SESSION`; admin e2e fixtures then log in with a second factor).
2. Employer discovery and public company profile pages; clearly labelled promotion (proposal only: three seven-day boosts a month, not advertised).
3. Opt-in public candidate profiles.
4. LinkedIn: candidate pastes a vacancy URL/text into the existing flow; no scraping, no Easy Apply.
5. E-mail application: detail-page and PDF extraction of explicit application addresses with stored evidence, once sources that publish them are reviewed.
6. Wider browser-agent support (other ATS, Chrome Web Store listing) after one genuinely authorized, observed submission.
7. Plan-based e-mail allowance (see §8.2).
