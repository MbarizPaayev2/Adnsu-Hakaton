# Next-session handoff (3 October 2026)

## 0. Session 4 (autonomous, 2026-10-03 evening) — baseline and result
- Baseline: `codex/vacancy-email-applications` at `0fe694aebc829ad85877e7c7360dc04ffa7abd70` (checkout `/Users/fizuli.050icloud.com/Projects/aise-deployment`, clean tree; CI on that exact SHA: `push` 37118906245 and `pull_request` 37118907775, both success).
- Commits this session (independent, in this order): **`a545bb4`** touch targets (accessibility); **`d3ff7b7`** eJob/JobSearch collectors + migration + Work.az deadline fix (scraper review); **`bf295a7`** Smartjob/Boss deadline fix; then the handoff commit (final pushed SHA is the branch tip and is reported in the session reply; its CI is read from PR #16).
- Accessibility: `docs/retention-and-product-handoff-2026-10-03.md` §12. Scraper review and integration: `docs/scraper-integration-2026-10-03.md`.
- The admin integration listed as "next task" in §6 was completed in session 3 (see §6).

## 1. Where things are
- Repository `/Users/fizuli.050icloud.com/Projects/aise-deployment` (authorised Projects checkout), branch `codex/vacancy-email-applications`, draft PR #16 (https://github.com/AISE-AZ/aise/pull/16), **base `codex/employer-source-coverage`**. Stack: #12 `claude/matching-eval` → main; #13/#14 → #12's branch; #15 → #13's; #16 → #15's. Nothing merged to main, deployed, migrated in production, charged or sent.
- Integration checkpoint head: `5bcb58f207b36b7257e4dbb99e3323b414863f42`; documentation head `8598e0ff250dfe461f7911ea50fbdb8a8229cfec`; session 3 added the admin merge `8abf6b9` and verification commits on top (final SHA is the tip of the branch and is reported in the session reply; the CI result for the final SHA could not be written into a file that is itself part of that SHA — read it from PR #16 / `gh run list --commit <sha>`). Last backend checkpoint before integration: `b320aa236ecf2d7cda839e6f12f0f0df448f380a`.
- Commits of the integration: merge `1b741d6` (frontend checkpoints), `3a39f27` (backend gaps), `bf4840f` (live adapter and screens), `5bcb58f` (browser journey, follow-key fix, docs), `8598e0f` (handoffs), `8abf6b9` (admin merge), then session-3 fixes and evidence.

## 2. Frontend checkpoints
| Checkpoint | Branch / SHA | State |
|---|---|---|
| Discovery/retention UI | `codex/discovery-ux` 79e799cebac772555bb35591065ef769f75bf9f1 | **integrated** (merge 1b741d6) |
| Employer UI | `codex/employer-ux-polish` 3aa2261907faa7206f25667dc6b93a9eba0e6927 (contains the discovery checkpoint) | **integrated** (same merge) |
| Admin UI | `codex/admin-ux-polish` 3976f99cac6838eef740e16a48f0f6b9e405b21d, handoff `docs/admin-ux-handoff-2026-10-03.md` | **integrated** in session 3 (merge `8abf6b9`), then corrected against the real API |

## 3. Evidence (all local, isolated `aise_phase2_test`, synthetic data, capture e-mail sink)
- Real-browser journey `apps/api/test/integration-browser.ts`: 26 checks passed (employer validation and retained values, native vacancy, DOCX onboarding, saved job/follow/search/preferences, persistence across refresh and fresh login, two-account isolation, failed-save rollback, follower-only native alert, double-click apply → one application, timeline-based dashboard, byte-identical downloads, cross-employer refusal, status-update rollback, employer-confirmed evidence with no e-mail, locked and unknown-count edit page, "—" counts, pending and suspended states). Synthetic rows left behind: 0. `phase4-native-browser.ts` re-passed.
- API unit 61 suites / 875 tests; `nest build`; e2e alerts-delivery 13, saved-retention 9, retention-journey 1, native-application 1, application-timeline 7, job-catalogue 18. Web `tsc`, Vitest 266 (39 files), `next build --webpack`.
- Bug found by the journey and fixed: follow button sent a bare company id; the API keys follows `company:<id>`.
- Details: `docs/retention-and-product-handoff-2026-10-03.md` §8; contract: `docs/frontend-contract-2026-10-03.md` §7.

## 4. CI (each result is for its own exact SHA)
`8598e0f`: `push` 37117890721 and `pull_request` 37117892361, both success. `5bcb58f` (below):
Run 37117330432 (`push`, `build-and-test`): success. Run 37117332007 (`pull_request`, `build-and-test`): success. No unresolved failures. Checked after the push; earlier heads' results are not counted.

## 5. Gates and gaps that remain (none attempted)
- **Release gates:** prices and a Premium product in the provider dashboard (`DODO_PRODUCT_ID_PREMIUM`); founder decision on tailored CVs behind Premium; Telegram bot, `TELEGRAM_BOT_TOKEN/USERNAME/WEBHOOK_SECRET`, registered webhook and live verification; alert e-mail provider verification (`NOTIFICATION_LINK_SECRET` ≥ 32 chars, `API_PUBLIC_URL`); real-provider e-mail, a Premium sandbox purchase; employer billing and the candidate-consent workflow (not built); the PR #12 gates (off-host backup, alert destination, images from the merged commit, rollback rehearsal); source-terms reviews; native-speaker lexicon review and threshold calibration. `PAYMENTS_ENABLED` stays false; rules mode stays opt-in; the consumed sealed v2 evaluation is unchanged.
- **Test gaps:** a real Redis/database outage in the admin health card; dashboard "unavailable" states in a browser (server-rendered; needs a stack-level fault, e.g. stopping the API mid-session); fixture guard on a public host in a real browser; `external-apply-real-worker` and `jobs-matching-real-scorer`; load test.

## 6. Session-3 outcome and what is next
Admin integrated and verified (details and evidence: `docs/retention-and-product-handoff-2026-10-03.md` §10–11): unified truthful health evaluator, backend `queuesUnavailable`, dialog focus fixes, roles/MFA/expired session, 12 admin pages and 19 candidate/employer screens at 320/390/768(/1440), mobile key journey at 390 px, and the deterministic apply-vs-question-edit race (which exposed and fixed a 500 → 409 on the apply side).
Touch targets (session 4): the 295 distinct controls under 44 px found by the real-geometry audit were fixed; now 0 (see retention handoff §12). Optional hardening: induce a real Redis/database health failure in the browser; candidate onboarding at 320 px; real touch/screen-reader checks.

## 7. Commands and prerequisites to resume
- Prerequisites: local Postgres on `127.0.0.1:5433` with database `aise_phase2_test` migrated; Redis on `127.0.0.1:6379`; Chrome for Testing at `~/.cache/puppeteer/chrome/mac_arm-150.0.7871.24` (or `CHROMIUM_PATH`); ≥ 4 GiB free disk. Never point tests at the local dev database `aise`; do not touch FVeda containers or Docker volumes. Always pass `DATABASE_URL` explicitly:
```bash
export DATABASE_URL='postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public'
```
- API (from `apps/api`): `npx jest` (unit); `npx jest --config ./test/jest-e2e.json --runInBand --forceExit <suite>` (one suite at a time); `npx nest build`.
- Web (from `apps/web`): `npx tsc --noEmit`; `npx vitest run`; `NEXT_PUBLIC_API_URL=http://127.0.0.1:4010 NEXTAUTH_URL=http://127.0.0.1:3450 NEXTAUTH_SECRET=<any local placeholder> npx next build --webpack`.
- Browser journeys (from `apps/api`, each starts and stops its own API on 4010 and Next on 3450; run one at a time; set `CHROMIUM_PATH` to Chrome for Testing if the default is missing): `test/integration-browser.ts` (candidate↔employer), `test/admin-mobile-browser.ts` (admin health/dialog/roles/session + 320–1440 layouts + 390 px key journey), `test/admin-browser.ts` (MFA, invitations, SUPPORT read-only), `test/phase4-native-browser.ts`.
- Touch targets: `test/touch-audit-browser.ts` (measures real hit areas with `document.elementFromPoint`; `TOUCH_AUDIT_OUT=/path.json`, `TOUCH_AUDIT_ALLOW=<n>` documented exceptions; fails on any control < 44 px or any horizontal overflow).
- Scraper previews (read-only, nothing ingested): from `apps/api`, `npx ts-node -r tsconfig-paths/register src/scripts/import-public-jobs.ts --source <ejob|jobsearch|work> --max-pages N --max-jobs M --delay-ms D`; integration: `npx jest --config ./test/jest-e2e.json --runInBand --forceExit new-public-sources public-job-import source-registry source-scheduler`.
- Race: `npx jest --config ./test/jest-e2e.json --runInBand --forceExit vacancy-question-edit-race`.
- CI: use `mcp__ccd_pr__get_status` plus one `gh run list --commit <full sha>`; do not poll in loops.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. No merge to main, deploy, production migration, live message, payment activation or scorer switch.

## 8. Session 4 additions: scraper state, remaining bugs and exact next steps
- **New collectors:** `ejob` and `jobsearch` registered (migration `20261014090000_register_ejob_jobsearch`, additive, applied to the isolated `aise_phase2_test` only; upgrade and drift tested on a disposable database that was dropped). `scheduled=false`, `ROBOTS_ALLOWED_TERMS_PENDING`, never `complete` → they cannot close postings. **Since session 5 both are also `enabled=false`** (migration `20261015090000_hold_ejob_jobsearch_pending_permission`): no published terms permit reuse, so the ingestion API refuses them until written permission is recorded (`docs/source-access-and-attribution-2026-10-03.md`).
- **Bounded live previews (read-only, nothing ingested):** eJob 31 discovered / 10 fetched / 10 accepted / 0 rejected; JobSearch 200 discovered / 5 fetched / 5 accepted / 0 rejected (30 s crawl-delay honoured); Work.az 12 discovered / 8 fetched / 8 accepted / 0 rejected. Duplicate-linked and uniquely-actionable counts were **not** measured (they need ingestion).
- **Remaining bugs/risks:** the other collectors were read for date-only deadline handling and need no change (details in the scraper doc); Work.az reaches only 12 active postings per fetch (its sitemap is entirely Aug–Sep 2025, stale); eJob `validThrough` is used as the deadline but looks platform-generated; JobSearch/eJob postings often have no city (flagged in the payload only); terms/attribution review pending; `parseStrictIsoDate` still reads zone-less times in the machine timezone where older code uses it for posting dates (observed values carry explicit zones).
- **Next steps:** (1) owner terms/attribution review for eJob and JobSearch; (2) small bounded staging import with `--apply` into a *non-production* API and the source-coverage report to measure duplicate-linked/actionable counts; (3) only after a verified complete eJob walk and headline reconciliation consider allowing `complete` for eJob; (4) the gates in §5 (prices, Telegram, real e-mail provider, PR #12 gates).
- **Prerequisites:** local Postgres 5433 (`aise_phase2_test` migrated through `20261014090000`), Redis 6379, Chrome for Testing (or `CHROMIUM_PATH`), ≥ 4 GiB free disk for browser runs; never the dev database `aise`; previews need outbound HTTPS and respect robots/crawl-delay (JobSearch preview of 5 details takes ~3.5 minutes).

## 9. Session 5: source verification and isolated import trial
- Baseline `5e7eacf` (CI green on that exact SHA). Commits: access hold + trial tooling `1a16ca3`, then the entity-decoding fix + results/documentation commit (final SHA = branch tip, reported in the session reply).
- **Access/attribution (primary sources):** `docs/source-access-and-attribution-2026-10-03.md` — neither site publishes a licence to reuse/republish; eJob: all rights reserved + stated technical measures against automated parsing; JobSearch: no terms page. Imports held; written permission needed.
- **Trial (disposable DB, real ingestion path, ≤ 50 details/source, sequential, paced, 36 min):** 111 stored/111 nominally actionable, 0 duplicates, 0 expired, **all 111 unknown-freshness** (platform windows: eJob 150 d, JobSearch 32 d, Work 30 d); idempotent (111/111 unchanged on replay, 16/16 on live re-collection); moderation + saved-job reference preserved; 60 partial/failed/limited run reports closed nothing; scoped-closure control proved. Details and the eJob entity bug found and fixed: `docs/scraper-integration-2026-10-03.md` §7.
- **Run it again:** from `apps/api`, `TRIAL_DETAILS=50 TRIAL_OUT=/tmp/trial.json npx ts-node --transpile-only test/source-import-trial.ts` (creates and drops `aise_scratch_trial_<ts>` on the local Postgres; needs Postgres on 5433 and outbound HTTPS; ~36 min at 50 details because of JobSearch's 30 s delay; use `TRIAL_DETAILS=2` for a 6-minute smoke).
- **Next highest-value step:** Work.az pagination (read its public client script for the "load more" contract, implement bounded pagination in the existing collector, never `complete`, re-run the trial); in parallel request written permission from eJob and JobSearch.
