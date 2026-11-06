# Source expansion integration, staging vacancy census and deployment handoff

Checkpoint: 2–3 October 2026 (inventory-quality update below supersedes the first census numbers). Branch `codex/vacancy-email-applications` (draft PR #16, base `codex/employer-source-coverage`). Nothing here is deployed; production, DNS, secrets, paid plans and live submissions are untouched. Real application e-mail is not enabled anywhere; the only provider used is a loopback sink.

## Integration
- Merged `origin/codex/azerbaijan-source-expansion` **in full** (tip `165bd50`, with `faada3d`, `a8e8279`, `68eb58d`): merge commit `d1497e7` on top of the e-mail application branch (`ef5a6c7`). Clean text merge; the source branch's migrations (`…0009`, `…0010`, `…0011`) sit beside this branch's (`…0005`–`…0009`). Two migrations share the `20261009090000` prefix (`register_expanded_public_sources`, `source_schedule`); neither depends on the other and Prisma applies both (verified fresh and upgrade).
- Integration defects found and fixed (each with a regression test):
  1. The scheduler knew only the old collectors, and the CLI had its own list: one shared `collectorFor`/`COLLECTOR_KEYS` now serves both (Smartjob, Boss, Work, Yelo, PASHA Holding schedulable; quarantined tenants and Glorri are not).
  2. `/internal/jobs/ingest` accepted jobs for any prefix: it now refuses unregistered, disabled or restricted sources (403), so quarantined tenants cannot write through the supported path.
  3. Board collectors always report "bounded/incomplete"; the scheduler treated that as failure and would have backed off forever. A bounded run is now healthy for backoff but never counts as a fresh complete listing.
  4. The application-e-mail extractor marked 14 SOCAR postings (contact address for questions) and flattened board postings as e-mail-applicable. It now needs a sentence that tells the candidate to send the application/CV; contact/support/question addresses never count; evidence is centered on the address. A `backfill-job-facts` script re-derives stored postings (dry run by default).
  5. Postings dated in the future or after their own deadline (3 Hellojob rows) are rejected by the parser and centrally.
- Quarantined tenants stay disabled (`accessbank`, `azerconnect`, `pasha-capital`, `bakcell`, `unibank`). `pasha-insurance` was re-registered, **not** as Workable: its career site is a Teamtailor site (the official pasha-insurance.az links to it). The `PASHA Insurance` adapter reads the public RSS feed (`/jobs.rss`, allowed by robots) and requires a stated Azerbaijani location. Verified employer adapters: **9** (SOCAR, Azercell, EY, Halliburton, ABB, PwC, PASHA Holding, Yelo Bank, PASHA Insurance); some legitimately have zero openings (EY).
- No downloaded JavaScript is executed; URL/redirect validation, size/time bounds, robots handling and immediate 403/429 aborts are unchanged; unknown, error or maintenance pages stay incomplete runs; board collectors never infer closures.

## Staging vacancy census (local, isolated `aise_census` database; NOT production)
Collected through the normal authenticated loopback API with 1.5 s pacing. Final recount, 3 October, after the Boss/Hellojob/Work fixes, the resume run and the duplicate relink, with test artefacts removed. Counts use the catalogue's own eligibility rules (active, not hidden, not a linked duplicate, deadline not past).

| Measure | Count |
|---|---|
| Stored postings (all states) | **2,248** |
| Expired (deadline past) | 780 |
| Open and visible, before duplicate exclusion | 1,468 |
| Linked duplicates (stored) | 48 (42 of them otherwise open) |
| **Open, unique under current deduplication rules** | **1,426** |
| Open, unique, explicit application e-mail | 224 |
| Employers represented (open, unique) | 669 |
| Postings with a future `postedAt` | 0 |

"Unique under current deduplication rules" means: the conservative linker found no repeat in the stored data. It is not a proven count of distinct real-world vacancies, and it excludes Glorri entirely.

| Source | Stored | Open unique | Expired | Duplicates | E-mail (open) | Runs |
|---|---|---|---|---|---|---|
| Hellojob | 974 | 565 | 367 | 48 | 95 | 4, all bounded |
| Boss.az | 399 | 399 | 0 | 0 | 91 | 3, all bounded (cap 400) |
| Work.az | 371 | 12 | 359 | 0 | 8 | 3, all bounded |
| Smartjob | 300 | 294 | 6 | 0 | 5 | 2, bounded |
| ABB | 103 | 58 | 45 | 0 | 0 | complete |
| PASHA Insurance | 35 | 35 | 0 | 0 | 0 | complete |
| SOCAR | 32 | 32 | 0 | 0 | 25 | complete |
| Azercell | 16 | 14 | 2 | 0 | 0 | complete |
| Yelo | 10 | 9 | 1 | 0 | 0 | complete |
| PASHA Holding | 5 | 5 | 0 | 0 | 0 | complete |
| PwC | 2 | 2 | 0 | 0 | 0 | complete |
| Halliburton | 1 | 1 | 0 | 0 | 0 | complete |
| EY | 0 | 0 | 0 | 0 | 0 | complete (explicit zero) |

Last runs: employer adapters finished 18:47–19:57 local; boards 19:17–21:22 (local, 2 October). Boards never count as a complete listing; no closure is inferred from them. Spot-check of five random Boss e-mail postings: every excerpt is an instruction to send the CV to the address (extractor v2).

Limits of this census:
- **Glorri is not in these numbers.** Its public listing reported 922 once (an unreviewed count, not ingested). Cross-source de-duplication against Glorri is not measured. Do not add 922 to 1,426.
- Boards are bounded: Hellojob (listing showed 1,040 discovered), Smartjob (600 listed, 300 fetched), Work (390 sitemap entries sampled; 359 stored postings are already expired), Boss (400-posting cap, only the first page of each category is rendered in HTML). A full inventory of 5,000 is **not** demonstrated.
- Counts are time-dependent: postings expire.

## Inventory quality fixes (3 October)
- **Boss stopped at 38.** Category 72 is genuinely empty: the page states `totalCount: 0` and has no next page. The collector read that as "no recognizable vacancy entries" and later as a pagination loop. An explicit zero with no next page is now an empty listing; any other page without entries still aborts the run as incomplete (tests: explicit empty, ambiguous first page, ambiguous mid-walk page, walking past an empty category). Result: 71 pages, 400 discovered, 399 stored.
- **Hellojob (20 failed of 700).** Classified: one employer undisclosed (rejected: no employer), and 21 of 45 unseen postings state a publication date after their own deadline or in the future. Impossible dates are never stored as publication dates; with a valid future deadline the posting is kept, `postedAt` is the first-seen time and the payload records why; otherwise it is rejected. Remaining failures in the resume run: 6 of 300.
- **Work.az.** Failures were archived pages with no structured posting (correctly rejected). The sitemap is read newest-first by `lastmod`, vacancy URLs only. Most of the sitemap is still expired postings (359 of 371 stored).
- **Resume without repeating detail requests.** `--skip-known-file` (one stored external id per line) is honoured by Hellojob and Work (`known` count in the report); ids are stable (`hellojob:<slug>`, `work:<id>`), ingestion is the normal authenticated route, and no finished import or waiter was restarted.

## Cross-source duplication
- **Confirmed and linked: 48**, all Hellojob postings linked to an ABB original, all by the rule below (44 were reviewed pair by pair earlier and were identical in title, employer and text; ABB states only the country, Hellojob a city). Rule `same_posting_location_unspecified`: ≥ 0.98 text similarity, same title, published within 3 days, one side country-only. Two different specific cities never link. Links write only `duplicateOfId` and `duplicateReason`; the original stays visible.
- **Suspected, deliberately not merged:** pairs that share employer and title but differ in location or text (8 Glorri/Hellojob pairs seen in the earlier historical snapshot). Reviewed by sample; no aggressive merge. No other source pair has any link, which shows no cross-source repeat passed the conservative rule, not that none exists.
- **Glorri:** unknown against current data. The importer is unchanged and not run in this census.
- `relink-duplicates` is a dry run by default; `--apply` is needed to write.

## Real-scorer matching journey (native ARM laptop; not production performance)
Full details and raw logs: `docs/evidence/scorer-native-arm-2026-10-03.md`.
- **Cause of the earlier failure.** The profile direction embeds the text of every posting on the scorer's CPU for every profile (≈ 0.65 s per posting, ≈ 16 text chunks each). A 100-posting chunk took 64–70 s natively, so the fixed 30 s timeout could never succeed; aborted requests also kept running inside the scorer, and the API stored the results of a partial pass (spending a free plan's allowance on the best of whatever chunks finished).
- **Changes (measurement-based, bounded).** 25 postings per chunk and a 60 s timeout, both configurable (`MATCHING_PROFILE_CHUNK_SIZE`, `MATCHING_SCORE_TIMEOUT_MS`); stop at the first failed chunk; nothing is stored for a partially scored profile; one scoring pass per profile at a time; the scorer cancels abandoned requests, limits concurrency (`SCORER_MAX_CONCURRENCY`) and caches job embeddings by text hash (`SCORER_EMBED_CACHE_MAX`, default 8,000 postings ≈ 300 MB).
- **Controlled browser journey** (real registration, verification, CV upload, onboarding, matches page, native scorer built for arm64 from the pinned lock and model): cold pass **57/57 chunks, 0 timeouts, 0 retries, 15.3 min** for 1,425 postings; warm pass **60.2 s from onboarding to 3 persisted matches** (real scores 0.654, 0.621, 0.613; matches page shown; free-plan selection verified as exactly the best three eligible results by re-scoring the whole inventory). A first run with a stub CV persisted no match because its best score (0.336) was below the 0.35 threshold, which is the correct outcome.
- **Remaining limits.** The cold time is the number a fresh deployment or an evicted cache pays; it is not a production measurement. Embedding at 5,000 postings is extrapolated (≈ 54 minutes cold). The deterministic alternative is evaluated in `docs/rules-matching-evaluation-2026-10-03.md` (not switched).

## Browser proof (local, real Chrome → real Next.js → census API; local sink provider)
7 checks pass (`test/census-browser.ts`): catalogue count equals the database (769 at that moment); search, source, company, location+category filters; expired and hidden postings disappear and a cross-source repeat (ingested through the real route) is linked and excluded while the original stays; detail keeps attribution and the source-site application path with no invented e-mail path; register → verify → CV upload → onboarding; matching produced 3 matches (free-plan allowance), all on eligible imported postings and none on hidden/duplicate/expired ones; an explicitly e-mail-applicable vacancy → preview → approval → one message with the exact CV to the sink, shown as provider-accepted. (The hidden state is set directly in the database in that script, standing in for the operator action; the verification mail is read from the database.)

## Test results (exact)
- API unit: 58 suites, 808 tests pass; `nest build` passes.
- Focused e2e on isolated `aise_phase2_test` (sequential): public-job-import, source-registry (incl. replay/ordering and ingestion gate), original-sources-isolation, source-scheduler, admin-email-ops, e-mail application (46), catalogue, dedup, account-access — 120 tests pass (earlier run), and admin-email-ops + public-job-import re-run after the last fixture change: 15 pass. The full 22-suite sequence passed (185) before the merge; it was **not** repeated in full after the merge and the Teamtailor adapter.
- Migrations: fresh database 31 migrations ✓; upgrade (23 → 31) ✓ identical result, zero schema drift; the corrective `20261012090000_register_pasha_insurance_teamtailor` applied to two isolated databases. Applied production history (≤ `20261004`) is unchanged; all new migrations are additive.
- Web unchanged this session (151 tests, production build passed at the previous checkpoint; not re-run).
- 3 October additions: Boss/Hellojob/Work/dedup/pilot-check unit specs; matching specs (67 pass: chunking, fail-fast, complete-or-nothing, single flight); scorer `selftest.py` and `rules_selftest.py` pass inside the arm64 image; web unit suite 168 pass and `tsc` clean after the UX merge; the native real-scorer browser journey passes (7 checks, warm); the full e2e sequence was not repeated.
- Not run / known: `jobs-matching-real-scorer` (needs a real scorer) and `external-apply-real-worker`; ESLint is not clean repo-wide (pre-existing).

## Scheduler readiness
Disabled by default (`SOURCE_SCHEDULE_ENABLED`, per-source `scheduled`, `import.scheduled` pause flag); one source per 10-minute tick, lease against overlap, ≥6 h interval, ≤12 pages/200 jobs/2 s spacing, exponential backoff to a week, stale/never-completed/manual labels, no Glorri, no restricted or disabled source. Rehearsed with synthetic collectors only. Readiness gaps before enabling any real schedule: source access/attribution reviews are all "terms pending"; boards never produce a complete listing (so they can add but never close, and will always read "never completed"); Boss pagination stops early.

## Controlled real-e-mail pilot: readiness (nothing sent)
`npm run script:email-pilot-check` (prints pass/fail and counts only; no secret, address or key) on a clean environment: **not ready**. Failing: feature switch off; transport is the local sink; provider key missing; verified sender missing; webhook signing secret missing; recipient allowlist has 0 entries; global daily limit 200 (pilot needs ≤ 50, per candidate ≤ 10). Passing: automation off, inbound replies off, startup guard accepts the configuration.

Authorization needed from the founder, in this exact form, before any real message:
1. A verified sending domain/address at the provider, and its API key and webhook signing secret set in the deployment secret store (you set them; they are not to be pasted in chat).
2. A webhook endpoint registered at the provider for the deployment's `POST /webhooks/resend` route (under the API global prefix, if any), signature verification on.
3. A written allowlist of controlled inboxes you own or whose owners consented (addresses or one domain), no real employer recipient.
4. Permission to set, on the pilot environment only: `EMAIL_APPLY_ENABLED=true`, live transport, global limit ≤ 50/day, automation and inbound off.
5. A named test candidate account and the CV to be sent. Then rehearse send, delivered, bounce, complaint, uncertain outcome, pause and deletion. No HR email is part of this authorization.

## Remaining blockers and gaps
- Founder review of PR #16 and a pilot; PR #12 release gates (off-host backup, alert destination, exact-head CI, images from the merged commit, rollback rehearsal).
- **Matching latency on production-class hardware is unmeasured.** The journey passes on a native ARM laptop; the cold full pass (15 min at 1,425 postings) is too slow for a first-match experience on a small CPU instance. Decide between a persistent embedding store and the rules-based mode (see `docs/rules-matching-evaluation-2026-10-03.md`) before launch, and set `MATCHING_PROFILE_CHUNK_SIZE`/`MATCHING_SCORE_TIMEOUT_MS` from a measurement on the real host.
- No real-provider (Resend) verification (see pilot readiness above).
- Source terms/attribution reviews are all pending; Glorri reconciliation and cross-source de-duplication against Glorri (not measured); boards are bounded and never produce a complete listing; Boss shows only the first page per category in its HTML; Work.az yields mostly expired postings; unknown city on 159+76 Hellojob/ABB postings (country-only location).
- Azerconnect (Oracle), PASHA Capital, Bakcell, UniBank, AccessBank AZ: not implemented or unverified.
- Verified-employer-approved recipients and inbound MX/DNS remain follow-ups.
- The full e2e sequence was not repeated after the final changes in this checkpoint.

## Stacked PR ancestry
#12 `claude/matching-eval` → `main` (not draft). #13 `codex/azerbaijan-job-sources` and #14 `codex/public-vacancy-catalogue` → #12's branch. #15 `codex/employer-source-coverage` → #13's branch. #16 `codex/vacancy-email-applications` → #15's branch (**not main**). All four bases and `codex/azerbaijan-source-expansion` are ancestors of the #16 head (verified with `git merge-base --is-ancestor`). Merge order: #12, then #13/#14, then #15, then #16, retargeting each to its parent's result; #16 alone must not be merged to main.

## Deployment plan and rollback boundaries (nothing executed)
1. Satisfy the PR #12 gates; review PR #16.
2. Back up; run `prisma migrate deploy` (additive, ordered; nothing destructive). Rollback boundary: the previous release image still runs against the new schema (new tables/columns unused); no data migration needs reversing. `backfill-job-facts` is dry-run first and only writes five fact columns.
3. Deploy with all new switches OFF (`EMAIL_APPLY_ENABLED`, `…_TRANSPORT=sink`, `SOURCE_SCHEDULE_ENABLED`, automation, inbound). Verify catalogue, matching and the existing Glorri importer unchanged.
4. Controlled pilot: sender domain + allowlist, then rehearse send/delivered/bounce/complaint/uncertain/pause/deletion against the real provider with controlled inboxes.
5. Only then consider enabling individual sources' schedules, one at a time, after source reviews. Rollback: flip the switch (or `import.scheduled` pause); stop the process; data stays.
6. After deploy, run `relink-duplicates` (dry run), review, then `--apply`; run `backfill-job-facts` dry run first. Neither deletes anything. Rollback of a link: set `duplicateOfId` and `duplicateReason` back to null on the listed rows (the dry-run output lists them).

## Candidate UX integration (3 October)
`codex/candidate-ux-polish` (tip `6db946e`, four commits by the frontend worker: filter pills and collapsible mobile filters, match keyword chips, job-detail sections, status hints, responsive safety) was merged with history preserved (merge commit `4942c43`); the tip had been unchanged for 40+ minutes and its worktree was clean, but if more commits are pushed later they need another merge. No file overlap with the backend work. One follow-up fix (`e2fb465`): the new applications-page hint said "E-poçt göndərildi" for a provider-accepted message, contradicting the existing status ("handed to the e-mail service, delivery unconfirmed"); it now says so. Checks: web unit suite 168 pass, typecheck clean, and the real-browser census journey (catalogue count, filters, detail with application path, register → matches → e-mail preview/approval to the local sink) passes against the merged web. Application methods, filter names and the sending safeguards are unchanged; this series has no PR of its own, so it travels with #16.

## E-mail pilot configuration checklist (names only; no value is stored in the repository, none was set, nothing was sent)
Pilot environment only, never production defaults. `npm run script:email-pilot-check` must report `readyForControlledPilot: true` first.
- `EMAIL_APPLY_ENABLED=true`; `EMAIL_APPLY_TRANSPORT` set to the live provider value (currently the sink); `RESEND_API_KEY` (secret store); `EMAIL_APPLY_FROM` (verified sender, domain with SPF/DKIM/DMARC); `EMAIL_APPLY_WEBHOOK_SECRET` (secret store) and the provider webhook pointed at `POST /webhooks/resend`.
- `EMAIL_APPLY_RECIPIENT_ALLOWLIST` (controlled inboxes or one controlled domain) and `EMAIL_APPLY_REAL_RECIPIENTS` left off; `EMAIL_APPLY_GLOBAL_DAILY_LIMIT` ≤ 50, `EMAIL_APPLY_USER_DAILY_LIMIT` ≤ 10, `EMAIL_APPLY_RECIPIENT_DAILY_LIMIT` small; `EMAIL_APPLY_MAX_ATTEMPTS`, `EMAIL_APPLY_PROVIDER_TIMEOUT_MS`, `EMAIL_APPLY_RETENTION_DAYS` reviewed.
- `EMAIL_APPLY_AUTOMATION_ENABLED=false`, `EMAIL_APPLY_INBOUND_ENABLED=false` (and `EMAIL_APPLY_INBOUND_DOMAIN` unset).
- Rehearse send, delivered, bounce, complaint, uncertain outcome, pause and deletion with a test candidate and the allowlisted inboxes only. Sending real CVs to real employers needs a separate, explicit decision; the earlier approval to send a deployment alert does not cover it.

## Checkpoint: design integration and rules-mode matching (3 October, later)
Full report: `docs/rules-matching-v2-2026-10-03.md`; evidence in `docs/evidence/`. PR #16 (`codex/vacancy-email-applications`) still targets `codex/employer-source-coverage`; the stack order and base relationships are unchanged and nothing was merged to main.
- **Design integration.** `origin/codex/site-quality-audit` at the frozen `08ae187` (approved landing `d1d7837`, `a824d76`, `5753b0f` and the product design system) was merged with history preserved (`4ff39bc`), no textual conflicts. The provider-accepted / delivery-unconfirmed wording, authorization, MFA, consent, quota and send safeguards are untouched by the diff (the design branch states it changed no handlers, migrations, mail transport or scorer selection; the merged web files were checked for the wording). Web Vitest 175 pass, `tsc` clean; the authenticated browser journey passes on the integrated UI. Not done: a production `next build` with real public environment values, and the design branch's own multi-viewport QA scripts against this stack.
- **Rules matching** (opt-in, default and thresholds unchanged): v2 evaluation set (synthetic, engineer-labelled, committed before scoring, dev + sealed), lexicon/scorer improvements for the four documented problems, version-aware posting cache. Sealed result (scored once): rules passes C1–C4, C6–C8, C10 and fails C5 by one disputed pair; the embedding scorer fails C5 by one pair too. Journeys (native ARM laptop, not production): cold 68.2 s and warm 1.0 s from onboarding to persisted matches, 0 retries/failures, one scorer pass for six simultaneous requests, free-plan best three verified.
- **Recommendation:** not ready for a production switch; ready for a shadow-mode canary after the gates listed in the report (native-speaker review by someone other than the author, a larger independent set, threshold calibration, staging shadow comparison, cache-persistence decision) and the release gates above.
- **Tests this checkpoint:** API unit 59 suites / 837 tests and `nest build` pass; e2e `jobs-matching` 4, `rescore-queue` 4, `silent-rescore` 4, `jobs-matching-real-scorer` 5 (against the rules scorer) pass; web 175 pass; scorer selftests pass in the arm64 image. Not run: the full e2e sequence.
