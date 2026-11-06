# MVP progress

Target launch: 5 October 2026. Baseline: `docs/mvp-2026-10-05-audit.md`.

Recovered checkout: `/Users/fizuli.050icloud.com/Projects/aise`
Branch: `codex/email-delivery-failures`
Parent: `b0f407d4e2c93900013b8a8c6ec3b8db8f8d0c02`

| Task | SHA | Evidence | Result |
|---|---|---|---|
| Prompt 1 — email-failure slice | `7141aa8` | Five focused specs in `~/Projects/aise` after lockfile `npm ci` and `prisma generate`. Desktop/iCloud runners remain unusable. | PASS (mocked unit tests only) |
| Prompt 1 — candidate/business account-access | `27b52ba` | Links taken from in-process captured HTML (`EmailService`), not DB token lookup. Shared `EmailModule` so capture matches Auth/Business send. Local postgres `aise-postgres` on 5433. | PASS (mocked transport + captured HTML). Not mailbox delivery. |
| Prompt 1 — browser UI account-access | `4377b28` | Playwright against live Next `:3450` + Nest `:4010`, mock Resend, `EMAIL_SINK_PATH` outside the repo. Cached Chrome for Testing (no `playwright install`). | PASS (browser UI + captured HTML). Not Resend acceptance. Not mailbox. |
| Prompt 1 — CV-to-profile | `11a0f1c` | Local DOCX/pdf.js extraction. Upload ownership on `/uploads`. Live Next `:3450` + Nest `:4010`, cached Chrome 1243. | API e2e PASS. Browser journey PASS. |
| Phase 1 — attachment retention + retryable verify | `43ba008` | Replacement no longer deletes a CV still referenced by `ApplicationFile`/`ApplicationAnswer`. Verify pages hash tokens, bound the cache, reuse in-flight POSTs, and retry only after 5xx/429/408/network errors. | PASS (focused unit + e2e) |
| Phase 1 — apply/replace/delete attachment concurrency | `6ba317c` | Applications attach a private copy of the base CV; resume replace/delete use compare-and-set on the resume row. Two-instance barrier e2e over the real HTTP routes. | PASS (unit + e2e, local postgres/redis) |
| Phase 1 — post-commit analytics must not undo an application | `d5649e6` | Analytics moved out of the DB-write try/catch in `apply`; a thrown `capture` is logged, not propagated. Cleanup-boundary e2e through the controller. | PASS (unit + e2e, local postgres/redis) |
| Phase 2 — active jobs, matching and candidate discovery | `7d9638f` | 67 API units, 4 database/queue e2e checks, 3 web units, both typechecks, authenticated browser rehearsal. Source HTTP and scoring responses are fixtures. | Local PASS; actual CPU-model and live-source verification OPEN. |
| Phase 2 — review fix: listing activity is not a content change | `aa086e2` | View counter/promotion flag excluded from the job content hash. | PASS (unit + e2e, isolated DB) |
| Phase 2 — real CPU-model rehearsal + scorer response validation | `41e881f` | Actual `apps/matching-service` (pinned model, CPU) through `JobMatchingService` and normal queues; malformed scorer responses now fail the attempt for retry. Live Glorri **not** sampled: permission not established. | Real-scorer PASS (local); live source OPEN |
| Phase 3 — factual tailored CV: request → fact-checked draft → review → approved PDF | this commit | Fake-provider unit/e2e/browser, Unicode PDF text + visual checks. No NVIDIA key configured: no live provider call. Engineer archive unavailable. | Local PASS (fake provider); live provider OPEN; archive comparison PENDING |
| Phase 5 — external application consent, attempts and truthful states (Glorri scope) | this commit (parent `8b343ad`) | 24 worker tests (15 unit + 9 adapter in Chromium on local pages), 50 API external-apply units (343 API units total), 13 API e2e on real Postgres/Redis with a loopback worker stand-in, 19 web tests (74 total), 6-step Chromium journey. Live sending stays gated; Glorri stays assisted-apply (no captured notice, no receipt contract). | Local PASS (fixture worker + fixture notice via DI); real Playwright fill against a form and recipient receipt proof BLOCKED → Phase 6 |
| Phase 6 — local worker + receipt verification (fixture ATS, real Chromium worker) | `b181c90` + ledger commit, branch `claude/phase5-and-worker-rehearsal` | Production web build; 44 worker tests (20 real-Chromium fixture cases); 349 API units; 14 fake-worker + 10 real-worker-process e2e; 77 web tests; two browser journeys (6 + 5 steps); cloud memory/latency table. | Local PASS. Authorised recipient test BLOCKED (owner input). Live sending still gated; Glorri still assisted-only. |
| Prompt 2 — founder super-admin, scoped roles, MFA, invitations, recovery | branch `claude/founder-admin` | 28 admin units (RFC 6238 vectors), 6 admin e2e over HTTP/Postgres, 84 web tests, 7-step admin browser journey, migration proven on a seeded copy. | Local PASS. Founder MFA enrolment and production migration NOT RUN (owner action). |
| Prompt 3 — founder operations dashboard | branch `claude/founder-ops` | 8 ops e2e + 6 admin e2e, 365 API units, 88 web tests, 8-step admin browser journey; Docker socket removed. | Local PASS. Backup status file, RELEASE_SHA and APP_ENV need the production host (NOT RUN). |
| Prompt 7 — billing lifecycle, notification delivery, account deletion | branch `claude/billing-lifecycle` | 378 API units (entitlement, deletion ordering, digest isolation), 8 billing e2e with signed webhooks and a local fake provider, 95 web tests; every local e2e suite re-run. | Local PASS. Dodo sandbox (real checkout, real webhooks, portal) NOT RUN — no sandbox credentials. |
| Prompt 8 — UX/UI polish of the working journeys | branch `claude/ux-polish` | Scripted sweep of 21 routes × 3 widths with Google Fonts blocked (before/after), 100 web tests, 379 API units, production web build. | Local PASS. Support contact and advertised services still need founder confirmation. |
| Prompt 9 — release verification and founder handover | branch `claude/release-candidate` (merges `origin/main` 03167f3) | 382 API units, 13 e2e suites, 44 worker, 100 web, all builds; 7 browser journeys incl. new founder handover on the real `dist/main.js`; migration upgrade from main's schema; real backup/restore scripts with age (5 passes, 3 negative checks, restored app usable). | Free native: GO conditional on host image build, matching self-test and mailbox test. External pilot: NO-GO (recipient receipt). Paid: NO-GO (Dodo sandbox). Nothing deployed. |

## CV browser (27 September 2026)

Stack: existing local postgres `aise-postgres:5433`, redis, Nest `4010`, Next `3450`, `EMAIL_SINK_PATH=/tmp/aise-account-access-email.jsonl`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. NextAuth was not rewritten.

`scripts/cv-profile-browser.mjs` required `/api/auth/session` with a user. After login, pathname `/dashboard` or `/dashboard/...` (onboarding). After **Tamamla**, exact pathname `/dashboard`. Then profile save, refresh, logout/login.

| Step | Result |
|---|---|
| UI register + captured-mail verify + credentials login | PASS (Nest `user_email_verified`; credentials callback ~288–433ms) |
| Empty-text PDF notice | PASS |
| DOCX extract Leyla Huseynova | PASS |
| Correct headline, save, `/dashboard` | PASS |
| Headline on `/dashboard/profile` after save | PASS |
| Headline after refresh | PASS |
| Headline after logout/login | PASS |

Script stdout: `PASS browser CV register/verify/login, extract, correct, save, refresh, relogin` (`browser_cv_exit=0`). Disk around **3.2–3.3 GiB** during the run; stack stopped afterward (**3.29 GiB**). NextAuth application login was not changed.

## Phase 1 (27 September 2026)

Closed the two open review findings. NextAuth was not rewritten. No push/deploy.

| Finding | Change | Evidence |
|---|---|---|
| Submitted CV deleted on base replace | `ResumesService.releaseUnreferencedFile` skips delete while `ApplicationFile` or `ApplicationAnswer` still points at the URL. Historical application URLs are not rewritten. Failed extract/replace leaves the current usable file. | `npx jest --config ./test/jest-e2e.json --runInBand test/cv-profile.e2e-spec.ts` — **2 passed** (including employer download of CV A after replacement B; other user/business 403; corrupt replace 400 keeps A and B) |
| Verify Map retained failures forever | Shared `verifyEmailOnce`: SHA-256 keys, 32-entry / 10-minute bound, in-flight reuse, terminal cache for 2xx/4xx, retryable for 5xx/429/408/network. Both candidate and business pages. | `npx vitest run src/lib/verify-once.spec.ts src/app/verify-email/page.spec.tsx src/app/business/(auth)/verify-email/page.spec.tsx` — **12 passed** |

Free disk during these checks: **~4 GiB**. Local Nest/Next were not started.

The attachment-retention fix above did **not** close concurrent apply vs replace/delete; that is closed in the next section.

## Phase 1 — attachment concurrency (27 September 2026)

Race closed: apply read base CV A → replacement set B → reference count found no application using A → A deleted → apply persisted an application pointing at deleted A. Counting references before deleting cannot prevent this.

A Cursor/Grok handoff patch (in-memory per-user `ResumeFileLock` + a mutable `afterSelectingBaseResume` hook on `JobApplicationsService`) was reviewed and **not** used: it only coordinated one Node process, `deleteResume` read the row before taking the lock, its waiter Maps never shrank, and it put a test hook on a production service. The unmodified patch is kept outside the repo at `~/Projects/aise-recovery/handoff-2026-09-27-resume-file-lock/`.

### Design

1. **Immutable application copy.** `JobApplicationsService.apply` copies the current base CV (`LocalStorageService.copyFile`, new random name, `COPYFILE_EXCL`) before inserting the application, and `ApplicationFile` points at that copy. Resume replace/delete never touch copies, so a submitted application keeps the exact bytes it was sent with, and replacing the base CV does not rewrite history. If the insert fails (e.g. duplicate application) the copy is removed.
2. **Source vanished before the copy.** If the base file disappears between reading the row and copying it: when the row has moved on (replaced/deleted) → **409**, nothing created; when the row still points at a missing file → **400** asking for a re-upload. Previously this silently attached a dangling URL.
3. **Compare-and-set on the resume row.** Replacement uses `updateMany where {id, userId, fileUrl: <file read>}`; delete uses `deleteMany` with the same condition. On a lost race → 409 and the replacement's new file is removed. The old file is released only **after** the row stopped pointing at it, and a failure in that post-commit release only logs (it can no longer delete the newly installed file).
4. **Legacy rows.** Applications created before this change point straight at base-CV files; `releaseUnreferencedFile` still skips files referenced by `ApplicationFile`/`ApplicationAnswer`. No new application references a base file, so that count can no longer race.
5. **Upload gate.** The pre-existing per-user in-process gate for same-user uploads is kept only to serialise double submits on one instance (so they do not 409 each other); its Map entry is now removed when the last queued upload finishes. Correctness does not depend on it.
6. **Account deletion.** Admin `deleteUser` now also removes application attachments (CV copies and question uploads), matching candidate self-deletion; otherwise CV copies would outlive the account.

### Limits (not claimed)

- Cross-process safety rests on Postgres row conditions and never-reused filenames on one shared uploads directory (compose: single `aise-api` container + `uploads` volume). Evidence is **two independent Nest application instances in one Jest process** (separate DI containers, Prisma pools and storage providers; asserted non-identical). Not tested across OS processes, hosts, or non-POSIX/object storage.
- A crash between copy and insert, or between commit and old-file release, leaves an **orphaned file** (storage leak, never a dangling reference). No sweeper exists.
- Each application stores its own CV copy (disk grows with applications).
- Vacancy/company/business deletion still leaves application files on disk (pre-existing, same as question uploads) — Phase 6 account/file lifecycle.
- External apply (`external-apply.service.ts`) still reads the live base-CV path at submission time; a concurrent replacement can remove it. Phase 5.
- Two concurrent first uploads (no base row yet) on **different** processes can still create two base rows; there is no DB uniqueness for a user's base CV.
- Frontend handling of the new 409 messages was not browser-tested; the API returns Azerbaijani messages.

### Checks (sequential, `--runInBand`, one suite at a time)

Targets: local docker `aise-postgres` (127.0.0.1:5433) and `aise-redis` (127.0.0.1:6379); no `apps/api/.env`, no `DATABASE_URL` in the shell, so the specs use their local default. No reset. Files under `apps/api/uploads` (gitignored). Free disk 6.2–8.1 GiB.

| Command (from `apps/api`) | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npx jest src/job-applications/job-applications.service.spec.ts src/admin/admin.service.spec.ts --runInBand` | **30 passed** |
| `npx jest --config ./test/jest-e2e.json --runInBand --verbose test/cv-apply-replace-race.e2e-spec.ts` | **8 passed**, 7.0 s, exits without `--forceExit` |
| same, with apply attaching the base URL and delete without the `fileUrl` condition (temporary mutation, reverted) | **6 failed**, 2 passed — the barrier tests detect the original race |
| `npx jest --config ./test/jest-e2e.json --runInBand test/cv-profile.e2e-spec.ts` | **2 passed** (legacy direct-reference case retitled, unchanged otherwise) |

The first race-suite run failed (7 × timeout/assertion): the test spied the `LocalStorageService` instance registered by `AuthModule` rather than the `ResumesModule` instance the services use. Test-only fix (`select(ResumesModule)`); barriers now fail after 10 s instead of hanging.

### Coverage — `test/cv-apply-replace-race.e2e-spec.ts`

Apply, replacement and delete go through the real HTTP routes (`POST /vacancies/:id/apply`, `POST /resumes`, `DELETE /resumes/:id`) on two API instances. Overlap is forced with jest spies on the real providers (`copyFile`, `uploadFile`, `prisma.resume.deleteMany`) that pause before/after the real call; no production hook. Every submission check downloads through `/uploads` and compares **exact bytes** for the employer and the applicant; another candidate and another business get **403**.

| # | Ordering (concurrent) | Expected and observed |
|---|---|---|
| 1 | apply copied A → replacement B commits and deletes A → apply inserts | 201; attachment = copy with A's bytes; base = B; B not readable by employer; a second candidate uploads and applies while this apply is parked (no cross-candidate blocking) |
| 2 | apply read A → replacement B deletes A → apply copies | 409; no application; no new file; retry → 201 with B's bytes |
| 3 | replacement wrote B, not committed → apply completes → replacement commits | 201 with A's bytes; replacement 201; A released |
| 4 | apply copied A → delete base CV → apply inserts | 201 with A's bytes; no base left |
| 5 | apply read A → delete base CV → apply copies | 409; nothing created; no new file |
| 6 | delete read A → replacement B commits → delete's conditional delete | delete 409; B remains base and byte-identical |
| 7 | replacement wrote B → delete commits → replacement's conditional update | replacement 409; its new file removed; no base row |
| 8 | sequential: apply, then corrupt replacement (400) and injected storage failure (500) | previous CV still base and byte-identical; submitted copy untouched |

Fixture boundaries: candidates register via `/auth/register` + `/auth/login` with `emailVerified` set directly (not mail); employer businesses, approved companies, vacancies and business sessions are created directly in the DB. The application itself is never inserted directly. Synthetic DOCX only; created users/businesses and their files are removed in `afterAll`.

Retained, not rerun (code unchanged): verify-page specs (12), account-access e2e/browser, CV browser journey.

### Post-commit cleanup fix (27 September 2026)

Defect in `6ba317c`: `application.create` and `postHogService.capture` shared one try/catch. If `capture` threw after the insert committed, the catch deleted the application's CV copy and the error reached the controller, which also deleted the question uploads — a saved application reported as failed with its files gone.

Change: the try/catch now covers only the database write (failure → remove this attempt's CV copy; the controller removes its question uploads; P2002 → 409). `capture` runs after it inside its own try/catch and only logs a warning (event name and error message, no personal data). No analytics features added.

| Command (from `apps/api`, sequential) | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npx jest src/job-applications/job-applications.service.spec.ts --runInBand` | **23 passed** (new: analytics throws → committed application returned, no file deleted; non-P2002 DB error → CV copy removed, error rethrown, no analytics) |
| `npx jest --config ./test/jest-e2e.json --runInBand --verbose test/apply-attachment-cleanup.e2e-spec.ts` | **3 passed**, 6.8 s |
| same unit + e2e with `capture` moved back inside the try (temporary mutation, reverted) | unit 1 failed; e2e 1 failed (`Expected: 201, Received: 500`) |
| `npx jest --config ./test/jest-e2e.json --runInBand test/cv-apply-replace-race.e2e-spec.ts` (unchanged test, rerun because `apply` changed) | **8 passed** |

`test/apply-attachment-cleanup.e2e-spec.ts` goes through `POST /vacancies/:id/apply` (multipart, one required `FILE_UPLOAD` question) so the controller's question-upload cleanup is exercised, not just the service. Spies target the `PostHogService` injected by `JobApplicationsModule` and the storage/Prisma instances apply uses.

| Case | Assertions |
|---|---|
| DB write succeeds, `capture('application_submitted')` throws | 201; exactly two new files (CV copy + question upload), both referenced by the stored application/answer; employer downloads both with exact bytes |
| DB write fails (`application.create` rejects once) | 500; the CV copy was really written, then it and the question upload removed (uploads directory identical before/after); no application row; no `application_submitted` event |
| Duplicate submission | 409; the second attempt's files removed; the only application row is deep-equal to the original (files, answers); employer downloads the original CV copy and portfolio with exact bytes |

Fixtures as in the concurrency suite: register/login through the API with `emailVerified` set in the DB; business, approved company, vacancy/question and business session created directly; the application is only created through the route. Local `aise-postgres`/`aise-redis`; free disk 8.1 GiB; `apps/api/uploads` back to its starting 18 files after the runs.

**Phase 1 status:** both review findings and the post-commit cleanup defect closed with local evidence. Not claimed: mailbox delivery, multi-host storage, browser handling of the new 409s.

**Next phase:** Phase 2 — active jobs and matching (import → listing → search → match → detail). Do not start Phase 3–8 in this slice.

## CV browser login diagnosis (retained; harness later aligned)

Fixes found only after reproduced failures (not NextAuth):

1. Verify pages posted the token twice under React remount; Nest consumed it then the UI showed invalid/expired.
2. `parseCv` counted account name/email fallbacks as `extracted`, so the scanned-PDF notice never appeared.
3. A second FREE base upload 403'd, so a real DOCX could not replace an empty PDF during onboarding. One base row is still kept; the file is replaced.

## CV browser login diagnosis (retained; harness later aligned)

Successful account-browser (`4377b28`) vs the earlier failed CV-browser used the **same** Nest `:4010` / Next `:3450`. Application auth was not weakened.

## Resource gate

Run completed with ~**3.3 GiB** free (user go-ahead below the earlier 5 GiB gate). Heavy work still stops below 2 GiB. No installs, browser downloads, DB reset, push, or deploy.

Guidance copies: `docs/mvp-2026-10-05-audit.md` and `docs/cursor-mvp-prompts.md` copied from `~/Desktop/aise/docs/` only.

## Specs (27 September 2026, recovered checkout)

| Spec | Result |
|---|---|
| `apps/api/src/common/email.service.spec.ts` + `email-link.util.spec.ts` + auth/business unit | 40 passed (unchanged; not rerun as a gate) |
| `apps/api/test/account-access.e2e-spec.ts` | 4 passed (retained) |
| `scripts/account-access-browser.mjs` | 22 PASS (retained) |
| `apps/api/src/resumes/cv-parser.spec.ts` | 42 passed (rerun) |
| `apps/api/src/resumes/cv-extract.spec.ts` + `upload-access.service.spec.ts` | retained with prior 52-count bundle except parser rerun |
| `apps/api/test/cv-profile.e2e-spec.ts` | 2 passed (rerun 27 Sep 2026 after the concurrency change) |
| `apps/api/test/cv-apply-replace-race.e2e-spec.ts` | 8 passed (27 Sep 2026) |
| `apps/api/src/job-applications/job-applications.service.spec.ts` + `admin.service.spec.ts` | 30 passed (27 Sep 2026) |
| `apps/web/src/lib/resume-file.spec.ts` | 4 passed (retained) |
| `apps/web/src/app/verify-email/page.spec.tsx` + business verify + `verify-once.spec.ts` | 12 passed |
| `scripts/cv-profile-browser.mjs` | PASS (live Next+Nest; retained, not rerun this phase) |

## Synthetic CV vs extraction (DOCX XML → `extractDocxText` → `parseCv`)

| Field | In synthetic CV | Extracted |
|---|---|---|
| Name | Leyla Huseynova | Leyla Huseynova |
| Email | leyla.cvtest@example.com | leyla.cvtest@example.com |
| Location | Gəncə, Azərbaycan | Gəncə |
| Headline | NestJS backend mühəndisi. | contains NestJS; browser then saved `Düzəldilmiş NestJS mühəndisi` |
| Skills | NestJS, PostgreSQL, TypeScript | those three present; no invented stub skills |
| Experience | Backend Engineer, Qafqaz Labs | title + company match |
| Education | Azərbaycan Texniki Universiteti | institution contains Texniki |

## Not claimed

- Prompt 1 complete
- Resend acceptance / mailbox
- Production deploy
- CV tailoring, jobs, applications, billing, admin-role

## Phase 2 — implementation and local evidence (27–28 September 2026)

Continued Claude's unfinished changes from `d5649e6aa58859af7ce75f04754526cc2f9655c5` on the same branch, preserving the inherited patch. Nothing pushed or deployed. **Do not mark the MVP or Phase 2's real-model verification complete.**

### Behavior

- Glorri collection traverses beyond known/promoted entries, de-duplicates identities, refreshes changed details, and records import runs. Listing calls have three bounded attempts and a 15-second request timeout; detail calls also time out. Repeated/malformed pages, page limits, failed details and suspicious inventory shrinkage remain PARTIAL/FAILED rather than pretending to be a full sync.
- Closures require a complete, healthy listing plus an absent job's 404/410 detail response. A still-reachable absent posting is not closed merely for missing two runs. Failed/partial listings do not reconcile closures. Confirmed detail content is required to create or reopen a posting. Closure updates and ordinary refreshes cannot overwrite a later observation.
- Additive Job lifecycle/freshness fields and JobImportRun migration were inherited. It was already applied to local `aise`; this turn also successfully applied all 16 migrations to a new, isolated `aise_phase2_test` database on the existing local Postgres. No existing database was reset or restored.
- Ingest updates preserve job identity. Matching queue IDs deduplicate identical content within a UTC day; changed/reopened content gets a new ID. An enqueue failure after the DB save is retried on re-import, with three worker attempts and bounded backoff. Import success is not proof matching completed.
- Matching excludes closed/expired jobs and unavailable native vacancies; forward matching uses completed profiles. Completed-profile edits enqueue re-matching and refresh scores/explanations without creating duplicate pairs. Incomplete scoring fails the task for retry. Profile saves remain durable if enqueue fails, and the editor reports that matching did not start and offers re-save as retry.
- New-match insertion and quota consumption now share one database transaction. A barrier test ran two real matching passes for the same new pair: one match and one quota charge. Monthly quota resets are conditional, so competing workers do not reset each other's usage.
- `/matches` and dashboard recommendations exclude inactive and below-threshold postings. Applied history remains visible; it does not consume the FREE display slots. Missing subscriptions fall back to FREE. The existing **three NEW matches per month** FREE entitlement is unchanged; filtering does not refund monthly quota or guarantee three active recommendations after jobs close.
- The matches UI searches the user's visible matches by title/company/description, filters location/status, opens job details by keyboard, shows skills/source/last-seen/deadline and handles retry/empty states. Closed application history disables new tailoring and source actions on this screen. Search is scoped to visible matches, not an unrestricted all-jobs search.
- External application creation, queued filling, confirmation and OTP now reject locally known closed/expired jobs. Existing live/dry-run gates remain in place. No external application was sent, and no external receipt is claimed. “Müraciət etdim” is manual tracking, not proof of submission.

### Evidence and boundaries

| Check | Result |
|---|---|
| API: jobs, scraper, matching controller/service, profile, external-apply units | **67 passed**, six focused suites |
| `test/jobs-matching.e2e-spec.ts` | **4 passed**: real local Postgres/Redis/Nest/auth and worker queues; fixture Glorri HTTP and scoring HTTP |
| Matches web component | **3 passed**: search/location/empty state, accessible details/inactive actions, fetch retry |
| API and web TypeScript | **PASS** |
| `test/phase2-browser.ts` | **PASS**, cached Chrome 1243 + real Next `3450` / local test Nest `4010` |

Browser: UI registration → verification from captured mock-mail HTML → actual credentials login; authenticated API creates the initial synthetic profile; normal import and queues generate matches; UI search/location/detail/source/freshness; **UI profile correction** → queued scoring → refreshed scores; injected failure in the actual profile service's queue instance → truthful saved-but-not-queued message → successful retry; manual applied history → synthetic job closure → disabled actions retained after reload; aborted matches request → visible error → successful retry. No match rows or auth verification tokens were injected for this journey. The concurrency test's second completed profile is direct fixture setup; it is not claimed as onboarding evidence.

Source and scorer are deterministic fixtures: the real `JobMatchingService` HTTP adapter and queues run, but the Python embedding model does not. Python available to this checkout lacks `numpy`, `sentence_transformers`, `torch`, `fastapi` and `uvicorn`; no environment/model/browser downloads were performed. Fixture scores **do not validate ranking quality**. Glorri was not contacted, and the source link was inspected rather than visited.

Earlier browser attempts exposed harness issues (verification copy selector, login timing, select accessible name, an invalid XPath and Next's empty route-announcer alert). They are not passes; the final corrected rehearsal exited 0. The location select now has an explicit accessible name. A queue fault initially targeted a different queue instance; the final test injects it into the instance used by ProfilesService and observes the actual failure/recovery.

Free disk finished around **7.94 GiB** (monitored every five seconds during browser work; start gate 5 GiB, stop threshold 2 GiB). Rehearsal Next/Nest stopped. Test users/jobs/import-run rows and uniquely prefixed queues were removed by the harness; the small isolated database/schema remains reusable. Existing AISE/FVeda containers and data were not reset or stopped. No full builds, browser downloads or concurrent suites.

### Review fix (28 September 2026)

Defect in `7d9638f`: the content hash included the whole listing payload, including Glorri's `viewCount` and `isProAd`. On the live source those change between hourly runs without the posting changing, so nearly every job would be recorded as `updated`, get a new `contentUpdatedAt`, and have matching re-queued (the queue id contains the hash) — misleading run counts and a full re-score every hour. No fixture carried `viewCount`, so tests could not see it. Those two keys are now excluded from the hash (still stored in `rawPayload`); any other payload change still counts.

| Command (sequential) | Result |
|---|---|
| `jobs.service.spec.ts` with the new case | **9 passed**; with the filter disabled (temporary mutation, reverted) **1 failed** |
| six focused API suites (command below) | **68 passed** |
| `test/jobs-matching.e2e-spec.ts` (isolated `aise_phase2_test`) | **4 passed** |
| API and web `tsc --noEmit` | PASS |
| `matches/page.spec.tsx` | **3 passed** |

`test/phase2-browser.ts` was not rerun: the change only affects unchanged-content detection, which the unit and e2e checks cover. Its `7d9638f` result is retained. Free disk 26 GiB.

### Real CPU-model verification (28 September 2026)

**Runtime (outside the repo, not committed):** `~/.cache/aise-matching-rehearsal/` — `uv` venv, CPython 3.13.12 (the Dockerfile's `python:3.13-slim` line), the 55 packages of `apps/matching-service/requirements-lock.txt` at their locked versions **minus the 19 Linux-only CUDA/`triton` pins** (no macOS wheels). torch 2.13.0 CPU (`torch.cuda.is_available() == False`), sentence-transformers 6.0.0, numpy 2.5.2; 851 MB installed (201 MB wheel download, sizes checked on PyPI first). Model `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` pinned to revision `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`, only the files the scorer loads (`model.safetensors` 471 MB + tokenizer/config; 477 MB on disk; the full repo with ONNX/OpenVINO/TF copies is 4.6 GB and was not fetched). `refs/main` points at that revision so the service's by-name load resolves to it offline. Service run with `HF_HUB_OFFLINE=1`, loopback `127.0.0.1:8787`, locally generated token (not printed), stopped afterwards. `selftest.py` → `ALL SELFTESTS PASSED`.

**Finding for deployment (not changed here):** the lockfile was `pip freeze`d on Linux with CUDA 13 wheels, so the Docker image installs several GB of GPU libraries for a CPU-only service. A CPU wheel index for torch would shrink it; decide when the matching container is next built.

**Adapter change:** `JobMatchingService` now rejects a scorer response unless `results` is an array whose entries carry a requested id and a finite 0–1 score (and array keywords). A malformed chunk is treated like an outage, so `MatchingService` reports incomplete scoring and BullMQ retries — previously `{results:[{}]}` for one profile counted as complete and silently stored nothing, and a `null` score was silently treated as below threshold.

**Rehearsal** `apps/api/test/jobs-matching-real-scorer.e2e-spec.ts` (new; separate from the fixture suite). `startPhase2App({ scorerUrl })` starts **no** fixture scorer; the suite fails if `AISE_REAL_SCORER_URL` is unset (verified: explicit error) or unreachable (verified: `ECONNREFUSED`). Isolated `aise_phase2_test` DB, unique queue prefix, real auth (captured mock mail), real `/profile` API, fixture Glorri HTTP. Outage/malformed faults are injected at the transport, never as scores.

| Case | Observed |
|---|---|
| Import → `job-ingested` → `/score` for a frontend profile | frontend **0.462**, backend 0.229, cook 0.202, closing-backend 0.174, accountant 0.131; expired job never sent to the scorer; stored match scores equal the service's; quota and notification jobs = matches created |
| Corrected completed profile (backend skills) → `profile-onboarded` → `/score-profile` | persona sent contains the corrected skills, not the old ones; backend **0.448**, frontend 0.277, cook 0.197, accountant 0.122; confirmed-closed (404) and expired jobs not sent; stored matches refreshed to the new scores; `/matches` lists only actionable ones |
| Same import + two identical profile saves again | same match ids, quota count and notification count |
| Injected outage / malformed response | attempt fails with `Incomplete profile scoring; retry required`; stored matches unchanged; BullMQ backoff retry succeeds against the healthy scorer; no extra quota or notification |

Threshold 0.35: the frontend profile matched only the frontend job; the corrected profile then also matched the backend job. These are smoke-test values from five synthetic postings — **not** ranking accuracy.

| Command | Result |
|---|---|
| `AISE_REAL_SCORER_URL=http://127.0.0.1:8787 MATCHING_SERVICE_TOKEN=… node ../../node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand --watchman=false --runTestsByPath test/jobs-matching-real-scorer.e2e-spec.ts` | **5 passed**, 17.6 s |
| `test/jobs-matching.e2e-spec.ts` (fixture scorer, harness change) | **4 passed** |
| seven focused API suites (six below + `src/matching/job-matching.service.spec.ts`) | **90 passed**; validation disabled (temporary mutation, reverted) → 6 failed |
| API `tsc --noEmit` | PASS |
| `CHROMIUM_PATH=<~/.cache/puppeteer Chrome for Testing 150.0.7871.24> … test/phase2-browser.ts` | **4 PASS lines, exit 0** (rerun because it shares the changed harness/adapter; still fixture scorer). The recorded Playwright Chromium 1243 cache no longer exists; the first attempt failed at browser launch before any step, not a test failure. No browser was downloaded. |

### Live Glorri source (28 September 2026) — OPEN

No recorded permission, agreement or documented API exists for Glorri in this repository; `docs/cursor-mvp-prompts.md` lists "Glorri integration permission/API details" as an owner input. Only public crawler policy was read: `jobs.glorri.com/robots.txt` disallows only `/_next/`; `api.glorri.com` (the undocumented `job-service-v2/jobs/public` listing the importer uses) has no robots.txt (404); `glorri.com/robots.txt` returns an HTML page. `robots.txt` is not permission, so **no listing or detail page was fetched** and no job row was touched.

Offline, against the 874 stored records in `apps/api/prisma/seed-data/glorri_jobs_detail.json` (August 2026 snapshot, not live): 874 unique slugs, 874/874 `Son tarix` deadlines parse (format `September 19, 2026`), 874 descriptions, 868 requirements, all destination URLs match `https://jobs.glorri.com/vacancies/<company>/<slug>?isLocal=true`, all `postedDate` ISO. This shows the adapter fits that historical shape; it does not show the current live contract or freshness.

**Owner input needed:** written confirmation that AISE may read Glorri's public listing API and job pages (or a documented feed / partner API), then a bounded sample (≤2 listing pages, ≤3 detail pages, read-only) can verify envelope, pagination, identity, deadline format and destination URL.

### Re-run and next boundary

Run from the recovered checkout. API focused tests use the installed root Jest binary from `apps/api`; web uses the root Vitest binary from `apps/web`. The e2e/browser harness **refuses a database other than local `127.0.0.1:5433/aise_phase2_test`**. Its 16 migrations must be applied before running it. Browser ports 3450/4010 must be free.

```sh
# apps/api
node ../../node_modules/jest/bin/jest.js --runInBand --watchman=false --runTestsByPath src/jobs/jobs.service.spec.ts src/scrapers/glorri/glorri-scraper.service.spec.ts src/matching/matching.controller.spec.ts src/matching/matching.service.spec.ts src/profiles/profiles.service.spec.ts src/external-apply/external-apply.service.spec.ts
node ../../node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand --watchman=false --runTestsByPath test/jobs-matching.e2e-spec.ts
node ../../node_modules/ts-node/dist/bin.js --transpile-only test/phase2-browser.ts
# apps/web
node ../../node_modules/vitest/vitest.mjs run src/app/dashboard/matches/page.spec.tsx
```

**Next:** real CPU-model smoke verification is recorded above (28 September). Still open: with owner permission, check a small authorized live Glorri sample for current response structure, deadline format and freshness. Re-run the real-scorer rehearsal with `AISE_REAL_SCORER_URL` + `MATCHING_SERVICE_TOKEN` against a scorer started from `~/.cache/aise-matching-rehearsal` (or the built container). The deadline parser currently recognizes English month names and leaves unrecognized dates unknown; fixtures cannot certify the live contract. Keep live auto-apply disabled. Do not advance to Phase 3 or claim launch readiness on these fixture results alone. Real mailbox delivery, tailoring, employer receipt, external receipt, billing, founder access and analytics remain separate phases/checks.

## Phase 3 — factual tailored CV workflow (28 September 2026)

Phase 2's live Glorri source check remains **OPEN** (permission). Neither Phase 2 nor the MVP is complete.

### Engineer archive — PENDING

`…/WhatsApp/Data/tmp/documents/948D1242-…/ats-harvard-resume.zip` no longer exists. A narrow search (Spotlight by name; Downloads, Documents, `aise-recovery`, the WhatsApp container; old Desktop repo excluded) found no copy. **Nothing from the archive was inspected or integrated.** The comparison (prompts/schema/validation/layout, the archive's year-regex, silent truncation and per-entry call-count issues listed in the master brief) waits for the archive to be reattached. This milestone improves AISE's existing NIM → Typst pipeline only.

### Defects found in the existing pipeline (before this change)

1. The model's company/position/period overrode the profile, and its education/skills/languages were taken wholesale — no fact validation; output went straight to `READY`.
2. Invalid JSON put up to 600 characters of raw model output into the error, which was logged and stored in `statusError`; provider error bodies (up to 800 chars) likewise.
3. Up to six HTTP calls per request (3 attempts + json-mode fallback) with a 300 s timeout each; no 429 handling, budget, deadline or per-user limit; no double-click dedupe; no actionable-job check.
4. Highlights silently cut to 5–6 and skill keywords to 8.
5. The resumes-page editor used the base-CV schema (`personalInfo`/`workExperience`) for tailored CVs: empty fields, and saving overwrote the draft with the wrong shape. Edits never regenerated the PDF.
6. Template font "Liberation Serif" does not exist on macOS (silent fallback); on a host that has it, coverage is unverified. Headings used Typst `upper()`, which renders Azerbaijani "İş təcrübəsi" as "İŞ TƏCRÜBƏSI" (dotless I) — found by the PDF text check. Section titles were English-only.

### Behaviour now

- **Facts:** the saved profile (the candidate's corrected CV facts) is the only source; the raw base-CV extraction is not used. `tailor-facts.ts` rebuilds the draft from facts and takes only fact-checked wording from the model (headline, summary, experience bullets, skill order). Removed and listed as review issues: invented employers/education/languages/projects/skills, sentences with numbers or years not in the facts, sentences naming technologies/proper nouns not in the facts (whole-word, suffix-tolerant for Azerbaijani/Turkish, e.g. `PostgreSQL-dən` OK, `Java` ≠ `JavaScript`; a sentence-initial job term such as "Kubernetes" is also checked). Changed positions/dates keep the profile value (warning). Output where nothing survives the check is `INVALID_OUTPUT`, never a draft. More than 8 generated bullets per entry → extra ones reported, not silently dropped; saved entries are never dropped.
- **States:** `PENDING` → `NEEDS_REVIEW` (draft, no file) → candidate edits → approve → PDF → `READY` (`reviewedAt`). `FAILED` carries a coded, content-free message (e.g. `(PROVIDER_TIMEOUT)`). Editing an approved CV returns it to review and withdraws the PDF. Pre-existing tailored `READY` rows have `reviewedAt = null` and are shown as "Köhnə versiya — yoxlanılmayıb". Nothing is sent to an employer.
- **Review edits:** wording is editable; identity facts are re-applied from the profile; a skill not in the saved profile is refused (correct the profile instead). The generic `PATCH /resumes/:id` now refuses tailored rows.
- **Request control:** per-user Postgres advisory lock (holds across processes) → an in-flight request for the same match is returned (double-click), daily limit `TAILOR_DAILY_LIMIT` (default 10 / 24 h) → 429; job/vacancy must be actionable; queue `jobId` = row id. A `PENDING` row older than 15 min is shown as `FAILED (STALE)`.
- **Provider bounds (env, defaults):** `NIM_API_URL` (NVIDIA chat-completions), `NIM_MODEL` (`openai/gpt-oss-120b`), `TAILOR_MAX_CALLS` 3, `TAILOR_TIMEOUT_MS` 60 000 per call, `TAILOR_DEADLINE_MS` 180 000, `TAILOR_MAX_OUTPUT_TOKENS` 4096, `TAILOR_MAX_RESPONSE_CHARS` 200 000, `TAILOR_MAX_RETRY_WAIT_MS` 10 000. 429/5xx/timeout/network and unusable output retry within the budget (Retry-After honoured, capped); other 4xx fail at once. Token usage, calls, latency and outcome codes are stored in `generationMeta` (no content). This is an NVIDIA API budget; Cursor/Grok credits are unrelated.
- **Worker:** idempotent under re-delivery (only `PENDING` rows; conditional writes); a draft that cannot render fails as `PDF_FAILED`. Approval compiles, uploads, then commits under a revision compare-and-set; a losing/failed attempt deletes its file. Logs carry ids and codes only.
- **PDF:** Libertinus Serif (bundled in the Typst compiler, OFL — identical on every host); section headings localised (az/ru/tr/en) and upper-cased with `toLocaleUpperCase(lang)`; periods rendered in the CV language (`sen 2015 – iyn 2019`, `yan 2022 – hazırda`); stored facts unchanged.
- Migration `20260928120000_tailored_resume_review` (additive: `NEEDS_REVIEW`, `reviewNotes`, `generationMeta`, `reviewedAt`, index) applied to local `aise` and `aise_phase2_test` only.

### Evidence (sequential, local Postgres/Redis, isolated `aise_phase2_test` for e2e/browser)

| Command | Result |
|---|---|
| API `tsc --noEmit`, web `tsc --noEmit` | PASS |
| `jest … src/resumes/tailor/{tailor-facts,resume-tailor.service,resume-tailor.processor}.spec.ts` | **34 passed** (fact checks incl. Azerbaijani/Turkish case, invented employer/skill/metric/term/education/language/project, surplus bullets, unusable output; call budget, Retry-After, 429 exhaustion, timeout, malformed→retry, 401 no retry, oversize, deadline, no key → no call, no content/key in errors; worker re-delivery no-op, closed/expired job after request, draft never READY, render failure, unexpected error redaction) |
| same + `job-applications`, `matching.service`, `profiles` specs | **85 passed** |
| `jest --config test/jest-e2e.json … test/tailored-cv.e2e-spec.ts` | **10 passed**, 4.5 s — double-click → one row and one provider call; reload while held → `PENDING`; corrected headline reached the provider, old one did not; worker re-delivery no extra call; invented facts absent and reported; 429/timeout/malformed → `FAILED` with code after exactly 3 calls, no model text, then a new request succeeds; other user 404 on read/review/approve, generic PATCH 400, unauthenticated 401; unsaved skill 400; PDF failure → stays `NEEDS_REVIEW`, no file; concurrent approvals → one file; download bytes = stored file; extracted text contains Azerbaijani/Russian/Turkish lines and `İŞ TƏCRÜBƏSİ`/`TƏHSİL`; embedded subset `LibertinusSerif`; other user 403 on the file; re-edit withdraws the PDF; closed job 400; stale `PENDING` → `FAILED (STALE)`; daily limit 429 with no new row; captured logs contain no CV text, model output or key |
| `cv-profile`, `cv-apply-replace-race`, `apply-attachment-cleanup`, `jobs-matching` e2e (shared resume service / harness) | 2, 8, 3, 4 passed |
| `vitest run …/resumes/tailored-review.spec.tsx …/matches/page.spec.tsx` | **7 passed** |
| `TAILOR_PDF_EVIDENCE_DIR=… ts-node test/phase3-tailor-browser.ts` (Chrome for Testing 150.0.7871.24 from `~/.cache/puppeteer`, Next 3450 + Nest 4010) | **4 PASS, exit 0**: UI register → captured-mail verify → login; double-click → one request; "Hazırlanır..." survives reload; draft review shows removed Google/Kubernetes/45%/MIT and blocks download; edit bullets + uncheck a skill → approve → downloaded PDF equals stored bytes, contains the edits, omits removed facts and the unchecked skill from the skills section; closed job: button disabled, API 400. Profile facts set via the authenticated API (profile UI correction is Phase 2 browser evidence). |
| `test/phase2-browser.ts` (rerun: shared harness changed) | 4 PASS, exit 0 |
| PDF visual | Approved PDF page 1 rendered with `sips`; 3-page stress CV (6 jobs × 8 long mixed-script bullets, 60-char unbreakable word, long e-mail) rendered via Typst SVG in Chrome for Testing: clean wrapping and page flow; text extraction found **48/48** bullets and 6/6 employers. Images kept outside the repo. |

**Fake-provider boundary:** `test/support/fake-nim.ts` is a loopback HTTP stand-in for the NVIDIA endpoint. It proves AISE's bounds, retries, fact checks, states, ownership and PDF path — **not** live provider acceptance, latency, cost, model availability or writing quality.

**Live provider — OPEN:** no `NVIDIA_API_KEY` is configured in the shell or any env file in this checkout, so no live call was made and no usage/cost is recorded. Needed: a company-owned NVIDIA API key (server-side secret), confirmation that `openai/gpt-oss-120b` (or the chosen `NIM_MODEL`) is available on that account, and approval for one bounded synthetic-data test.

**Other limits:** the claim checker is heuristic (it cannot judge a lowercase paraphrase that overstates a fact; the candidate's review is the final control); the daily limit counts requests including failed ones; tailoring is free on every plan (no charge exists to duplicate); tailored PDFs of a deleted account are removed by account deletion as before, but the orphan sweep for crash-left files is still missing.

Free disk 24 GiB throughout. Processes started for the browser runs (Next/Nest, fake provider, Chrome) were stopped by the scripts; ports 3450/4010 free. Files created in `apps/api/uploads` by these runs were removed (18 files, as before); PDFs/screenshots kept in the session scratchpad only.

**Next:** with an owner-supplied NVIDIA key, one bounded live synthetic tailoring test; reattach the engineer's archive for comparison; then Phase 4 (native candidate → employer journey). Live Glorri access (Phase 2) remains open.

## Phase 4 — native candidate → employer application (28 September 2026)

**Local implementation and verification complete; not released.** A candidate must select a usable, owned CV: the base CV or a tailored CV they have reviewed and approved. A missing CV is rejected; another user's CV returns 404; pending and legacy unreviewed tailored CVs are rejected. Applying copies the selected CV into the application, preserving the exact submitted bytes when the candidate later replaces the base CV. The submit UI prevents a double-click from creating two applications. Rejected submissions clean up their question uploads and CV copy.

Approved employers can create a vacancy with required questions, see the candidate's answers and download the submitted CV and file answers through the authenticated web bridge. The bridge rejects dot-segment paths. An employer's status change is shown only after the API succeeds, and the candidate sees the updated status. Public vacancy listing/detail exclude expired deadlines. Question replacement after applications exist returns a conflict, including the foreign-key race. Admin company lists include the business email for approval.

**Evidence:** API and web typechecks passed. API focused units: 50 passed. Native application, attachment cleanup, CV-profile and CV replace/apply race e2e: 14 passed in the isolated local `aise_phase2_test` database. Web apply-page, employer-detail and business-proxy tests: 17 passed. The local Chromium browser run passed admin approval → employer vacancy with required text/file questions → candidate DOCX upload and onboarding through the website → selected CV and answers → double-click produces one application → employer downloads both original byte sequences → status change visible to candidate → expired employer session redirects to login. The API e2e also checks a second employer and second candidate cannot access the application or files, an unapproved employer cannot publish, and expired/paused vacancies cannot accept applications. A prior CV replace/delete race test failed once without captured output; it passed 8/8 in twelve later runs and in this final focused run (14 total e2e tests). Cause of that isolated failure remains unknown.

**Boundary:** All accounts, vacancies, files and mail in these runs are synthetic and local; email uses mock capture. This does not prove live Resend mailbox delivery, authorized live Glorri access, NVIDIA tailoring, external auto-apply, production behavior, billing or founder-admin access. No production deployment or migration was performed. Phase 2's Glorri permission check and Phase 3's live-provider check remain open; this milestone alone does not make the MVP launch-ready.

## Phase 5 — external application state and consent (28 September 2026)

**Local implementation and verification complete; not released; live sending not enabled.** Work continued in a cloud session from the preserved WIP commit `8b343ad` (`codex/email-delivery-failures`), on branch `claude/zen-curie-m8lq50`. Phase 4 was not redone.

### Behaviour now

- **Destination registry (server-only, `destinations.ts`).** Hosts, the recipient's declaration (text, URL, version) and the receipt contract are code-reviewed configuration; nothing is client-supplied. Apply URLs are rebuilt from the allowlisted host and validated slugs (https, `/vacancies/<company>/<slug>/apply`, no query/fragment); the worker re-checks its own copy of the allowlist before opening anything. **Glorri has `notice: null` and `receipt: null`**: its declaration has never been captured by an authorised person and no confirmation page has been observed, so production offers only the assisted route and no send could ever be recorded as a confirmed receipt.
- **States.** `DRAFT` (destination, actual notice and exact disclosure shown; nothing transmitted) → consent → `FILLING` → `NEEDS_INPUT` (unknown screening questions asked of the candidate; the recipient declaration is never an answerable question) / `READY_FOR_REVIEW` → `SUBMITTING` (claimed, attempt persisted) → `AWAITING_OTP` / `SUBMITTED` (only with a receipt validated against the destination contract: safe reference + URL path + text SHA-256, never page text) / `DELIVERY_UNCONFIRMED` (timeout, reset, worker 5xx/409/proxy 408/504, page without receipt, error-like text after activation, malformed/forged reply, stale in-flight) / `FAILED` (known not sent, or OTP attempts exhausted) / `EXPIRED` / `CANCELLED` / `SUBMITTED_DRY_RUN`. Pre-existing `SUBMITTED` rows without a receipt reference are shown as "Göndərilib, qəbul təsdiqlənməyib".
- **Consent.** Recorded per application with candidate, vacancy, destination host/URL, notice version + fingerprint, approved field keys, the exact disclosed values (+hash) and document hashes with reasons. The request must echo what the server would transmit now; any mismatch (notice, host, fields, documents, profile values) is `409 PREPARATION_CHANGED`. Documents are copied to private snapshots at consent; replacing the base CV later does not change what is sent, and a snapshot whose bytes changed blocks the send (`SNAPSHOT_CHANGED`). The ID photo is requested only because the destination entry says the form requires it, with the reason shown.
- **Send.** Every final submit and OTP re-checks ownership, plan, live gate, pilot list, actionable vacancy, destination allowlist, consent (absent/revoked/other vacancy/notice changed/destination changed), session expiry and the reviewed version. The claim (conditional `READY_FOR_REVIEW → SUBMITTING` plus the attempt row, with the daily limit counted under a per-user advisory lock) commits before the worker is contacted. The attempt id is client-generated (UUID v4); a repeat is a replay that returns the current state; an id belonging to another application is refused. Only a connection that provably never reached the worker (ECONNREFUSED/ENOTFOUND/EAI_AGAIN) or a guard/validation refusal (400/401/403/413/415/422) returns the row to review as not sent. Nothing is ever resent automatically; the reconciler turns an attempt still in flight after `EXTERNAL_APPLY_STALE_SUBMITTING_MS` into `DELIVERY_UNCONFIRMED`. An application that ended after the final control was activated (OTP pending then cancelled/lost/expired/exhausted) or may have been sent blocks a new automated application for that match.
- **Answers vs send.** Writing answers first invalidates the reviewed version, so a confirm for the version the candidate saw cannot race an edit; the worker also refuses to send while answers are being written (`SESSION_BUSY`, not sent).
- **Worker.** Per-application reservation before browser launch (a second create for the same application is 409, capacity counted before launch, slot released on every path); one attempt per session at a time; the final control is marked spent before the adapter runs, so an exception mid-click can never allow a second activation and is reported as possibly sent; completed attempt results are replayed; its own `EXTERNAL_APPLY_LIVE_ENABLED` gate stops confirm and OTP in sessions created before the gate went off (session kept); invalid OTP keeps the session; sessions with an attempt or an edit in flight are never swept. Dry run never activates the control (checked by a fixture assertion) and cannot reach OTP; a dry-run request is refused unless `ENABLE_SANDBOX=true`.
- **Fixes found while testing the WIP:** `pg_advisory_xact_lock` returned `void`, which Prisma could not deserialize — every "start" and every real send would have failed with 500 (now `SELECT 1 … FROM pg_advisory_xact_lock(...)`); the adapter's "Davam et" lookup waited the full 30 s action timeout on the review step; error-like page text after activation was recorded as a known rejection (`FAILED`, re-application allowed) — now uncertain.
- **Web.** `/dashboard/apply/[id]` shows vacancy, destination host and apply URL, the recipient's declaration text/version/link, every field value and document with its reason, missing profile data, and two explicit scoped approvals before consent; unsupported/gated destinations get the assisted route only. The review screen shows the consented values, candidate answers, documents and the form's own preview before a confirmation dialog; progress, OTP (remaining attempts), confirmed receipt with reference, unconfirmed delivery (no resend button), failure, expiry and cancellation are described without claiming success; a lost reply retries with the same attempt id. The matches page shows "Avtomatik müraciət hazırla" only when the server capability says available, links an existing application instead of starting another, and otherwise explains why and keeps "Glorri-də bax" + "Müraciət etdim".

### Evidence (cloud container; ephemeral Postgres 16 on 127.0.0.1:5433 `aise_phase2_test`, Redis 127.0.0.1:6379, Chromium 1194 at `/opt/pw-browsers/chromium`)

| Command | Result |
|---|---|
| `apps/apply-worker`: `npx tsc --noEmit`; `npx jest src/sessions/sessions.service.spec.ts` | PASS; **15 passed** (allowlist, authority passthrough, capacity reservation, duplicate create, replay, in-flight refusal, exception mid-send, busy during edits, gate off confirm/OTP, dry run, OTP keep/close, sweep skips in-flight) |
| `CHROMIUM_PATH=/opt/pw-browsers/chromium npx jest src/sessions/adapters/glorri-apply.adapter.spec.ts` | First run **7/9** (2 timeouts: the Davam-et bug above); after the fix **9 passed** (shared fingerprint vector, allowlist, declaration ticked only on matching fingerprint, dry run never clicks, observed-not-received, OTP/rejection/missing control) |
| `apps/api`: `npx tsc --noEmit`; `npx jest src/external-apply` | PASS; **50 passed** (`destinations.spec.ts` shares the worker's fingerprint vector `22b0c6f0…4f2b`; gates/consent/ownership/review version/expiry/snapshot/dry run/daily limit refusals with no attempt row and no worker call; worker reply → state table incl. forged outcome, foreign attempt id, 401/404/408/409/500/504, refused connection, timeout) |
| `apps/api`: `npx jest` (all units) | **343 passed**, 30 suites. The previous `external-apply.service.spec.ts` (pre-Phase-5 API, 18/18 failing on DI) was replaced. |
| `npx jest --config test/jest-e2e.json --runInBand test/external-apply.e2e-spec.ts` | **13 passed** in each of the two final runs: nothing transmitted before consent; changed notice/fields/documents refused; another candidate 404 everywhere; screening answer asked, declaration not answerable, stale review version refused; two concurrent confirms → one worker call, one attempt, receipt → `SUBMITTED` + match `APPLIED`; double-click + later retry → one send; attempt id reuse across users 409; uncertain blocks re-application/capability; timeout → `DELIVERY_UNCONFIRMED`, never resent by a new attempt or the reconciler; refused connection → back to review, `NOT_SENT`; crashed in-flight → reconciled uncertain; cancel during send 409 "geri götürmür", cancelled review cannot be sent, consent revoked; revoked consent/expired session/gate off stop the send; gate off at OTP; OTP invalid → valid with receipt, replay no resend; forged body/worker status ignored; dry run refused without sandbox and a dry run claiming OTP is a violation; base CV replaced during preparation → snapshot bytes unchanged, tampered snapshot blocks |
| `prisma migrate deploy` on the fresh DB; `prisma migrate diff --from-migrations … --to-schema-datamodel …` | All migrations incl. `20260929090000_external_apply_consent_attempts` applied; **no difference** |
| `apps/web`: `npx tsc --noEmit`; `npx vitest run` | PASS; **74 passed** (14 files) incl. 14 apply-page and 2 new matches-page tests; ESLint on the changed apply page is clean, matches page unchanged from its baseline findings |
| `PHASE5_EVIDENCE_DIR=<scratchpad> npx ts-node --transpile-only test/phase5-external-browser.ts` | **6 PASS, exit 0**: login; matches CTA → draft → destination/notice/fields/documents, consent disabled until both approvals, nothing sent before; screening answer; exact review; double-click on send → one worker call, one attempt; OTP wrong then right → receipt `GL-UI-0001`; timeout → "Çatdırılma təsdiqlənməyib", no resend, matches links status; gate off → assisted route only. Screenshots kept in the session scratchpad only |
| `git diff --check` | clean |

**Stand-ins (not claimed as real):** `test/support/fake-apply-worker.ts` is a loopback HTTP stand-in for the worker contract (no browser, no destination). The fixture notice/receipt contract is injected into e2e/browser tests through Nest DI; production code still has none. The adapter was exercised in Chromium only against local `page.setContent` pages with all network aborted.

### Configuration and migration needs

- Migration `20260929090000_external_apply_consent_attempts` (additive: two enum values, eleven nullable/defaulted columns, two tables). Applied only to the ephemeral local test DB here; **not** to any shared or production database.
- API: `EXTERNAL_APPLY_LIVE_ENABLED` (off unless `true`), `EXTERNAL_APPLY_PILOT_USER_IDS` / `EXTERNAL_APPLY_PILOT_EMAILS`, `EXTERNAL_APPLY_DAILY_SEND_LIMIT` (5), `EXTERNAL_APPLY_SEND_TIMEOUT_MS` (120 000), `EXTERNAL_APPLY_FILL_TIMEOUT_MS` (180 000), `EXTERNAL_APPLY_SESSION_TTL_MS` (1 200 000; keep equal on API and worker), `EXTERNAL_APPLY_STALE_SUBMITTING_MS` (600 000), `EXTERNAL_APPLY_MAX_FILL_MS` (300 000), `ENABLE_SANDBOX` (dry run only), `APPLY_WORKER_URL`, `APPLY_WORKER_TOKEN`. Worker: `EXTERNAL_APPLY_LIVE_ENABLED`, `EXTERNAL_APPLY_MAX_SESSIONS` (10), `EXTERNAL_APPLY_SESSION_TTL_MS`, `APPLY_WORKER_TOKEN`.
- `apps/apply-worker` tests use the hoisted root `jest`/`ts-jest`; the package does not declare them.

### Remaining — BLOCKED / NOT RUN

- **BLOCKED (Phase 6, recipient proof):** the real Playwright fill/send against a controllable local ATS fixture, measured memory/latency, process loss around the final send, and one authorised Glorri test. Until an authorised person records Glorri's live declaration (text, policy URL, version) and a controlled recipient test documents a receipt contract, `GLORRI_DESTINATION.notice`/`.receipt` stay `null`, automated preparation stays unavailable in production, and live sending stays gated. No real Glorri page, candidate or production data was used.
- **NOT RUN:** email/notification on state changes, admin reconciliation UI for `DELIVERY_UNCONFIRMED`, worker restart replay memory (in-process; the persisted attempt still prevents a second send from AISE), production build of the web app.
- The OTP-field and error-text detection remain heuristics from the reference prototype; neither can mark success (only the receipt contract can).

## Phase 6 — local worker and receipt verification (28 September 2026)

**Local verification complete; recipient proof BLOCKED; nothing released or enabled.** Built on the pushed Phase 5 commit `7668ec6` in the cloud session, on `claude/phase5-and-worker-rehearsal` (checkpoints `f0edb9a`, `a38f60e`, `7d1dedc`, `ee10321`, `b181c90`, then this ledger commit). No merge, deploy, production migration, Cloudflare/DNS or production-server action; Glorri was not contacted; no real application was submitted; all accounts, documents and vacancies were synthetic.

### How the fixture is wired (production validation unchanged)

- `apps/apply-worker/test/support/fixture-ats.ts`: a loopback ATS shaped like the Glorri form the adapter targets (step 1 personal data + Mantine-style selects + CV and ID uploads, step 2 motivation + hidden `g-recaptcha-response`, step 3 questions + the recipient declaration with its policy link, review dialog, then OTP / receipt page / refusal). The scenario is chosen by the vacancy slug. The server records final-control clicks and submissions (field names, file sizes and SHA-256 — never file contents).
- The worker still opens the allowlisted `https://jobs.glorri.com/vacancies/<company>/<slug>/apply` URL and runs its unchanged allowlist check. Only a **test seam** (`SessionsService.prepareContext`, a no-op in production and set only by test code) routes that host to the fixture and aborts every other host. The test worker entry point is `apps/apply-worker/test/support/fixture-worker-main.ts`; production still starts `dist/main` (the Dockerfile copies `test/` sources but `tsconfig.build.json` excludes them and nothing runs them). API clients still cannot supply a URL: the API derives it from the stored job. The fixture's notice/receipt/refusal formats reach the API only through Nest DI overrides in tests.

### Changes (found by exercising the real worker)

- **Worker/adapter:** stop at a visible human-verification challenge (reCAPTCHA v2 checkbox/challenge, hCaptcha, Cloudflare Turnstile; an invisible reCAPTCHA badge does not count) before preparation or the send — never attempt to pass it; if the click itself raises one, report it (`MANUAL_INTERVENTION_REQUIRED`) as possibly sent. Treat a **new** alert after an upload as a refused upload (`UPLOAD_FAILED`), ignoring alerts already on the page. Fail a form that never reaches its review control (`REVIEW_NOT_REACHED`) instead of offering it for review. After the final click and after an OTP, wait for the page's own network activity to settle (bounded by `EXTERNAL_APPLY_SEND_OBSERVE_MS`, default 20 000) instead of a fixed 2 s — a 3 s-late receipt or OTP prompt was otherwise missed. Bounded Playwright action timeout (`EXTERNAL_APPLY_ACTION_TIMEOUT_MS`, default 10 000) so a changed form fails in seconds, not 30 s per field. Unanswered questions carry the visible question text (fieldset legend / radiogroup label) instead of the DOM name `questions.0.answer`. Refusals carry the observation.
- **API:** a refusal is a known outcome (`FAILED DESTINATION_REJECTED`) only when the page matches the destination's documented `rejectionPattern` on an allowlisted host — for both `REJECTED` and plain observed pages; otherwise it stays `DELIVERY_UNCONFIRMED`. A challenge raised by the click → `DELIVERY_UNCONFIRMED CHALLENGE_AFTER_SEND`. Clear Azerbaijani messages for each stop reason. The review screenshot is retaken after the candidate's answers (the old one showed the unanswered form) and the old file removed. **Retention:** the reconciler deletes review screenshots and private CV/ID copies of ended applications after `EXTERNAL_APPLY_EVIDENCE_RETENTION_DAYS` (default 30); consent, attempts and receipt reference/hashes remain.
- **Web:** `useAuthedFileUrl` no longer keeps showing the previous (already revoked) image while a new one loads; a CAPTCHA stop shows the "apply yourself" route; the post-click CAPTCHA reason is explained.

### Evidence (cloud container: 4 vCPU, 15.7 GiB; ephemeral Postgres 16 on 127.0.0.1:5433 `aise_phase2_test`, Redis 127.0.0.1:6379, Chromium 1194 at `/opt/pw-browsers/chromium`; all runs sequential)

| Command | Result |
|---|---|
| `apps/web`: `npx next build` | **PASS** twice (before and after the Phase 6 web changes), exit 0, TypeScript included, no warnings — the Phase 5 "production build NOT RUN" item is closed |
| `apps/apply-worker`: `npx tsc --noEmit`; `npx jest --runInBand src/sessions` | PASS; **44 passed**: 15 session unit, 9 adapter-on-local-pages, **20 real-Chromium fixture cases** — normal fill → review with 0 clicks → one confirm → receipt page, destination received exactly the CV/ID bytes (size + SHA-256); dry run: 0 clicks, 0 submissions; required questions asked with their visible text, never guessed, declaration not among them; changed notice → `NOTICE_CHANGED`, box not ticked; refused upload → `UPLOAD_FAILED`; standing alert not mistaken for one; OTP wrong (session kept) → right → receipt; expired OTP → not accepted, session kept; visible refusal observed; 3 s-delayed response → receipt observed; renamed fields → `FILL_ERROR` < 20 s; renamed final control → `REVIEW_NOT_REACHED`; unexpected navigation to `/login` → observed without receipt; visible CAPTCHA → stopped, invisible badge → not; CAPTCHA after the click → reported; dropped connection after the destination recorded it → observed without receipt; two concurrent confirms → one click; capacity 1 → 503 then slot returns; browser launch failure → `FILL_ERROR`, slot released; TTL expiry swept → `SESSION_NOT_FOUND`, 0 clicks; every test asserts no browser outlives its session |
| `apps/api`: `npx tsc --noEmit`; `npx jest` | PASS; **349 passed** (56 external-apply, incl. documented vs undocumented refusal, foreign-host refusal, challenge before/after activation) |
| `npx jest --config test/jest-e2e.json --runInBand test/external-apply.e2e-spec.ts` | **14 passed** (Phase 5 suite + evidence retention: ended application's screenshot/CV/ID copies removed after the period, record kept; in-progress files never touched) |
| `npx jest --config test/jest-e2e.json --runInBand test/external-apply-real-worker.e2e-spec.ts` | **10 passed** (~170 s): API → real worker **process** (token guard, Playwright, Chromium) → fixture. Validated receipt → `SUBMITTED` with the snapshot bytes at the destination; questions → answers → fresh screenshot → `SUBMITTED`; changed notice (consent revoked), refused upload, CAPTCHA, changed form → `FAILED` with 0 clicks; OTP wrong → right; documented refusal → `FAILED DESTINATION_REJECTED`; navigation away → `NO_RECEIPT_EVIDENCE`; CAPTCHA after click → `CHALLENGE_AFTER_SEND`; dropped connection → unconfirmed, second confirm 409, new application 409, reconcile, still 1 click/1 submission; sandbox dry run → 0 clicks; concurrent confirms → 200 + 409, 1 click; destination slower than the API timeout → `DELIVERY_UNCONFIRMED` although the fixture later issued a receipt, never claimed or resent; worker capacity 2 → third preparation `FILL_FAILED`, nothing sent; **worker SIGKILL during the final send** → `DELIVERY_UNCONFIRMED`; restart + reconcile → in-flight stays uncertain, untouched review session → `EXPIRED SESSION_LOST`, nothing resent; no orphaned Chromium processes afterwards |
| `apps/web`: `npx tsc --noEmit`; `npx vitest run` | PASS; **77 passed** (15 files) incl. the stale-image hook test and CAPTCHA/unconfirmed states. ESLint on changed files: no new findings (the hook's one `set-state-in-effect` finding is pre-existing) |
| `PHASE5_EVIDENCE_DIR=… npx ts-node --transpile-only test/phase5-external-browser.ts` | **6 PASS** (rerun after the web changes) |
| `PHASE6_EVIDENCE_DIR=… npx ts-node --transpile-only test/phase6-real-worker-browser.ts` | **5 PASS**: UI → API → real worker process → Chromium → fixture: questions shown with their text, review shows the worker's current screenshot, double-click → one send, receipt `FX-0001` validated and shown; visible CAPTCHA → stopped, assisted route, 0 clicks; OTP wrong → right → receipt; dropped connection → "Çatdırılma təsdiqlənməyib", no resend button. Screenshots (synthetic data only) kept in the session scratchpad, not the repository |
| `apps/apply-worker`: `npx ts-node --transpile-only test/measure-sessions.ts` | Table below; 0 Chromium processes left |

**Cloud measurements — this test container, not production capacity evidence.** Fill = open + fill + two uploads (200 KiB/300 KiB synthetic files) + three steps to review against the loopback fixture; confirm = final click to settled page. PSS (proportional set size) does not double-count Chromium's shared pages.

| Live sessions | Fill p50 / max (s) | Confirm p50 / max (s) | Worker node PSS (MiB) | Chromium PSS total (MiB) | Per session (MiB) |
|---|---|---|---|---|---|
| 1 | 8.8 / 8.8 | 1.0 / 1.0 | 181 | 204 | 204 |
| 2 | 8.8 / 8.8 | 1.0 / 1.0 | 157 | 287 | 144 |
| 4 | 9.1 / 9.1 | 1.2 / 1.2 | 184 | 451 | 113 |
| 6 | 9.5 / 9.5 | 1.3 / 1.4 | 198 | 613 | 102 |

Fill time is dominated by the adapter's fixed waits ported from the reference prototype (≈1.5 s after load, 0.4–0.5 s per select/upload, 1 s per step); real-site latency will add network time. Each session is a separate Chromium browser (~100–200 MiB); `EXTERNAL_APPLY_MAX_SESSIONS` (default 10) should be set from the intended host's memory with headroom.

### Configuration

New, all optional: `EXTERNAL_APPLY_ACTION_TIMEOUT_MS` (worker, 10 000), `EXTERNAL_APPLY_SEND_OBSERVE_MS` (worker, 20 000; keep well below the API's `EXTERNAL_APPLY_SEND_TIMEOUT_MS`, 120 000), `EXTERNAL_APPLY_EVIDENCE_RETENTION_DAYS` (API, 30). A destination entry may add `receipt.rejectionPattern`. No schema change in Phase 6.

### BLOCKED — owner input required

- **Authorised recipient test.** Needed from the founder: a cooperating employer's (or documented Glorri sandbox) test vacancy URL; written permission from that recipient; a consenting test candidate with the data/documents to use; a named time window. Then, with live sending enabled only for that pilot user: record Glorri's live declaration text, policy URL and a version label into `GLORRI_DESTINATION.notice`; observe the real confirmation page and write `receipt.textPattern`/`urlPathPattern` (and `rejectionPattern` if the site shows one) from it; run one send; record destination, timestamp, redacted receipt reference and the recipient's confirmation. Until then `notice`/`receipt` stay `null`, production offers only "apply yourself", and `EXTERNAL_APPLY_LIVE_ENABLED` stays off.
- **Live-DOM mapping.** The adapter's selectors, the OTP heuristic, the error-text heuristic, the question-label lookup and the upload-alert check are verified against the fixture only; the live Glorri form may differ.

### Other limits (not claimed)

- Expired OTP is reported as "Kod yanlışdır" (not distinguished from a wrong code); requesting a new code is not automated.
- Worker attempt replay memory is in-process; after a worker restart the API's persisted attempt still prevents a second send.
- The worker is single-process (sessions are not shared across replicas).
- Measurements come from a 4 vCPU cloud container with a loopback fixture.

## Prompt 2 — founder super-admin and secure operator management (28 September 2026)

**Local implementation and verification complete; production migration and founder enrolment pending.** Branch `claude/founder-admin` (stacked on `claude/phase5-and-worker-rehearsal`).

### Behaviour
- **Roles** `SUPER_ADMIN` / `ADMIN` / `SUPPORT` with a server-enforced matrix (`apps/api/src/admin/permissions.ts`). Every admin route declares a permission; the guard denies a route without one. The role and disabled flag are re-read from the database on every request. `SUPPORT` is read-only and receives no identity-document reference. Account deletion, stack restart and operator management require `SUPER_ADMIN` **and** a session created with a verified second factor.
- **Migration** `20260930090000_admin_roles_mfa`: existing operators become `ADMIN` (their current capability, never more); new operators default to `SUPPORT`; only an existing row matching `ceo@aisehr.com` (case-insensitive) becomes `SUPER_ADMIN` — no account is created, and its password, identity and audit history are untouched. Proven on a seeded copy (founder row → SUPER_ADMIN with the same hash and audit rows; another operator → ADMIN); `prisma migrate diff` shows no drift.
- **MFA**: RFC 6238 TOTP (checked against the RFC appendix B vectors), secret AES-256-GCM encrypted with `ADMIN_MFA_ENCRYPTION_KEY` (32 bytes, base64; without it enrolment is refused), each time step accepted once, ten SHA-256-hashed single-use recovery codes. Login is two-step: password → httpOnly, path-scoped challenge cookie (5 min, 5 attempts) → code → session. A `SUPER_ADMIN` cannot turn MFA off.
- **Self-service** (`/admin/account`): password change (current password + code when MFA is on; ends every other session), session list and revoke, MFA enrolment, recovery-code regeneration.
- **Operators** (`/admin/operators`, SUPER_ADMIN): invitations by email through a single-use 72 h link (only its hash stored; a failed delivery revokes it), role change, disable/enable (ends sessions immediately), revoke sessions, 2 h password-reset link, reset another operator's MFA. The last active `SUPER_ADMIN` cannot be demoted or disabled — enforced under a Postgres advisory lock; two concurrent cross-demotions leave exactly one. Every change is audited with before/after and no secrets.
- **Web**: shared permission-aware admin header; MFA step on the login page; `/admin/setup` for invitation/reset links; cookie-proxy routes reject cross-site state-changing requests (Origin check) on top of `SameSite=Lax` httpOnly cookies.
- **CLI** (no password in argv/env/shell history; hidden prompt; bare Prisma client instead of the whole AppModule): `npm run script:create-admin -- --email … [--role SUPPORT|ADMIN]` creates only, `SUPER_ADMIN` only when none is active; `npm run script:admin-recover -- --email …` interactively resets password and/or MFA, re-enables, ends sessions and audits — requires typing the email to confirm. Piped input also works (read once, fails loudly if short).
- Fixed on the way: approving/rejecting an unknown company returned 500 (now 404).

### Evidence
| Command | Result |
|---|---|
| `apps/api`: `npx tsc --noEmit`; `npx jest src/admin` | PASS; **28 passed** (RFC 6238 vectors, base32, replay window, AES-GCM tamper/wrong key, matrix, login paths, no secrets in responses) |
| `npx jest --config test/jest-e2e.json --runInBand test/admin-access.e2e-spec.ts` | **6 passed**: candidate/forged tokens 401 everywhere; SUPPORT/ADMIN 403 on every hidden action incl. direct role escalation; MFA-required reason; wrong, replayed and reused codes and exhausted challenges refused; recovery code works once; invitation link single-use under two concurrent submissions, revoked/expired links refused, re-invite of an existing operator 409; last-super-admin protection incl. concurrent cross-demotion; demotion/password rotation/reset link/disable take effect on existing sessions; operator list and audit carry no secrets |
| CLI against the local DB (piped input) | create-only, second SUPER_ADMIN refused, recovery requires typed confirmation, audit rows written |
| `apps/web`: `npx tsc --noEmit`; `npx vitest run` | PASS; **84 passed** (MFA login step, permission-filtered header, operators page MFA-required state, invite/role-change calls, self-row has no actions, account enrolment shows recovery codes once, Origin check) |
| `ADMIN_EVIDENCE_DIR=… npx ts-node --transpile-only test/admin-browser.ts` | **7 PASS**: httpOnly session cookie; operator management refused before MFA; enrolment from the account page with 10 recovery codes; login needs the code, wrong code refused; SUPER_ADMIN invites SUPPORT; link accepted once then dead; SUPPORT sees read-only navigation and hidden API calls return 403; disabling ends the session at once |

### Owner actions (NOT RUN here)
1. Set `ADMIN_MFA_ENCRYPTION_KEY` (e.g. `openssl rand -base64 32`) as a server secret and `ADMIN_WEB_URL` to the public admin origin; back the key up with the database backups (losing it means re-enrolling MFA via `admin-recover`).
2. Apply the migration during the authorised release; then the founder logs in, enrols MFA at **/admin/account** and stores the recovery codes offline.
3. Confirm the founder controls the `ceo@aisehr.com` mailbox before inviting operators (invitation and reset links go by email; Resend must be configured in production — missing configuration fails the send and revokes the link).
4. Existing operators other than the founder are `ADMIN` after the migration; review them on /admin/operators and demote to `SUPPORT` where appropriate.

## Prompt 3 — founder operations dashboard (28 September 2026)

**Local implementation and verification complete.** Branch `claude/founder-ops` (stacked on `claude/founder-admin`). Migration `20261001090000_founder_operations` (additive: `BusinessStatus.SUSPENDED`, `Company.suspendedReason`, `Job.hiddenAt/hiddenReason`, `User.suspendedAt/suspendedReason`, `PlanOverride`, `FeatureFlag`).

### What the panel does (every action has a server implementation, permission and audit entry)
| Page | Contents | Actions (role) |
|---|---|---|
| **Ümumi baxış** `/admin/overview` (landing) | users (verified/suspended), companies by status, listings (active/closed/hidden), matches 24 h, native and external applications by status, recent failures (failed tailored CVs, unconfirmed external deliveries, failed queue jobs, e-mail failures since API start), last import, paused features | — |
| **Əməliyyatlar** `/admin/operations` | pause switches, Glorri import runs, queue counts, failed jobs with redacted errors | pause (reason required) / resume, request import (deduplicated; refused while paused/running), retry failed jobs only in `job-ingested`/`profile-onboarded` (idempotent) — ADMIN, SUPER_ADMIN |
| **Elanlar** `/admin/listings` | external listings with source, lifecycle, last seen, hidden state, match counts; search/filters/pagination | hide (reason) / restore — hidden listings leave recommendations and new applications and stay hidden when an import reopens them |
| **Müraciətlər** `/admin/applications` | native and external applications by status (no answers, files or identity documents); `DELIVERY_UNCONFIRMED` flagged for manual reconciliation | none (uncertain deliveries are never retried) |
| **İstifadəçilər** `/admin/users` | effective plan (override or provider), activity counts, suspension | plan override with reason + 1–365-day expiry (provider contract shown read-only, never edited); suspend (reason; ends sessions, blocks sign-in) / restore; delete (SUPER_ADMIN + MFA session) |
| **Bizneslər** | adds SUSPENDED | suspend (reason) / restore approved employers — every existing `APPROVED` check excludes SUSPENDED, so their vacancies disappear and new applications/vacancies are refused |
| **Audit** `/admin/audit` | actor, action, target, time, metadata; filters, pagination; opening a candidate record writes `USER_RECORD_VIEWED` | — (ADMIN, SUPER_ADMIN) |
| **Sistem** `/admin/system` (replaces Deploy) | environment, release SHA, API uptime, database/Redis/matching/apply-worker checks with latency, last backup and restore-test age | none — states plainly that the page does not deploy or restart |

- **Pause switches** (`FeatureFlag`, durable): `external_apply.submissions` is enforced in `ExternalApplyService.blockingReason`, i.e. capability, create, consent, fill, final send and OTP (`OPERATOR_PAUSED`); `import.glorri` makes the import processor skip and refuses operator imports. Resuming never enables live external applications (the `EXTERNAL_APPLY_LIVE_ENABLED` gate, pilot list, consent and receipt rules still apply).
- **Plan overrides** are separate rows with reason, expiry, creator and revocation; one entitlement function (`apps/api/src/billing/entitlement.ts`) now feeds every plan gate (match quota, recommendation limit, digests, dashboard, CV rules, external apply). The old endpoint that edited `Subscription.plan` directly was removed.
- **Docker socket removed** from the API container (and `dockerode`): the restart button that gave host-root to the public API is gone; `/admin/deploy` redirects to `/admin/system`. `scripts/deploy.sh` exports `RELEASE_SHA`; `docker-compose.yml` passes `RELEASE_SHA`, `APP_ENV` and mounts `/var/backups/aise/status` read-only; `backup.sh` and `restore-test.sh` write `status.json` there after verified runs.
- Environment badge (production/staging/test) in every admin page header; SUPPORT sees only read pages.

### Evidence
| Command | Result |
|---|---|
| migration on the local DB + `prisma migrate diff` | applied; no drift |
| `npx jest` (apps/api) | **365 passed** (incl. entitlement-driven quota with an override, hidden-listing filter) |
| `npx jest --config test/jest-e2e.json --runInBand test/admin-ops.e2e-spec.ts test/admin-access.e2e-spec.ts` | **14 passed**: overview/health (release, environment, backup age from a status file, unreachable services reported), SUPPORT 403 on every action, restart endpoint gone; pausing external applications makes the real `ExternalApplyService` refuse and resuming restores it, audited before/after; import paused → 409, dedup; unsafe queues not retryable; hidden listing stays hidden and non-actionable after an import reopens it; suspension ends sessions and blocks login until restore; company suspend/restore; plan override changes the effective plan without touching the subscription, expires, is revocable and audited; old plan edit 404; record view audited |
| `npx vitest run` (apps/web) | **88 passed** |
| `npx ts-node --transpile-only test/admin-browser.ts` | **8 PASS** (Prompt 2 steps + operations: pause requires a reason, shows immediately, disables "İndi idxal et", appears in Audit and on the overview; System page makes no deploy claim) |

### Owner actions (NOT RUN)
- On the host: create `/var/backups/aise/status`, run `scripts/backup.sh` and `scripts/restore-test.sh` so the panel has real ages; set `APP_ENV=production`; deploy with `scripts/deploy.sh` so `RELEASE_SHA` is set.
- Not built (by design): arbitrary shell/SQL/env editing, secret viewers, payment-contract edits (use the Dodo dashboard), retrying uncertain external deliveries.

## Prompt 7 — billing lifecycle, notification delivery, account deletion (28 September 2026)

Branch `claude/billing-lifecycle` (on top of `claude/founder-ops`). Migration `20261002090000_billing_lifecycle`.

### What changed
- **Webhooks are applied once and in any order.** Each delivery id gets a `BillingWebhookEvent` row, and a delivery that was already processed is acknowledged unchanged. Every `subscription.*` event re-reads the subscription from the provider (`subscriptions.retrieve`) and stores that state: status, plan from `product_id`, next billing date and `cancel_at_next_billing_date`. This means late, duplicate or out-of-order events cannot resurrect a lapsed plan, and `plan_changed` now changes the plan (before, it was ignored). If the provider cannot be reached, the API returns 503 and the event stays unprocessed, so Dodo retries it. The following grant nothing and are recorded with an outcome: unknown products, subscriptions that map to no account, and stale events for an older subscription.
- **Entitlement follows payment status** (`billing/entitlement.ts`). A paid plan applies only while the provider status is `active`, with a 3-day grace after the period end for a renewal not yet reported. `on_hold`, `past_due`, `paused`, `failed`, `expired`, `cancelled` and `pending` all mean FREE. The match quota now uses the same rule. Operator overrides still win.
- **Payments are honest when they are not configured.** `GET /billing/status` returns `{paymentsEnabled, mode}`. In production with only the mock key, or with `PAYMENTS_ENABLED=false`, checkout returns 503; the pricing, checkout and settings pages disable purchase and say "Ödənişli planlar hələ aktiv deyil". The mock return URL no longer carries `plan=`. The dashboard never trusts the return URL: after `?checkout=success` it polls `/billing/subscription`. It announces the plan only when the API confirms it; otherwise, after about a minute, it says the payment is not confirmed yet and not to pay twice. `GET /billing/subscription` now returns both the effective plan and the provider contract, including the status, the scheduled cancellation and any override. Settings shows these in Azerbaijani, including "abunəlik bitir" for a cancellation at period end.
- **One account-deletion path** (`accounts/account-deletion.service.ts`), used for both self-service `DELETE /auth/account` and operator `DELETE /admin/users/:id`:
  1. Refuses while an external application is `SUBMITTING`/`AWAITING_OTP`.
  2. Cancels billing at the provider first, and deletes nothing if that cannot be confirmed; 404 at the provider counts as nothing to stop.
  3. Closes live apply-worker sessions.
  4. Deletes the rows in one transaction; for operators, the masked-email audit entry is written in the same transaction.
  5. Removes every stored file afterwards: CVs incl. tailored, ID document, application copies and answer files, external snapshots and screenshots. Any file that survives is logged and counted.

  Before this change, the operator path deleted files before the rows and never cancelled billing.
- **Notification delivery**:
  - Daily digest:
    - One user's failed send no longer aborts the run for everyone else.
    - A failed send records nothing, so a rerun retries only that user.
    - At most one digest per user per Baku day; the in-app record is written only after a successful send.
    - Suspended users and lapsed subscriptions get none.
    - Copy is now Azerbaijani.
  - Match digest: skips suspended users, and no longer writes the recipient address to logs.
- A pre-existing test regression from Prompt 2 was fixed: `native-application.e2e` created an operator without a role, and since Prompt 2 that means SUPPORT.

### Verification (local, synthetic data, isolated `aise_phase2_test`)
| Command | Result |
|---|---|
| `prisma migrate deploy` + `prisma migrate diff` | applied; no drift |
| `npx tsc --noEmit`; `npx jest` (apps/api) | PASS; **378 passed** |
| `npx jest --config test/jest-e2e.json --runInBand test/billing-lifecycle.e2e-spec.ts` | **8 passed**. Covered: a forged signature gives 400 and records nothing; a payload claiming Limitsiz still gets the purchased Basic; a redelivered id is acknowledged without re-applying; `plan_changed` moves to Limitsiz; `on_hold` gives FREE, and a late `active` event does not resurrect it; a scheduled cancellation keeps access and shows the end date; `cancelled` gives FREE; provider down gives 503 and the event stays unprocessed, while the retry applies it; unknown product and unmapped subscription grant nothing. Self-deletion: wrong password 401; provider down 503, with the account and files intact; then success, with the provider cancelled and the rows and files gone. Operator deletion: 409 while sending, then the session is closed and a masked audit entry is kept. |
| Other e2e, one suite per run: `admin-access` 6, `admin-ops` 8, `external-apply` 14, `external-apply-real-worker` 10, `account-access` 4, `apply-attachment-cleanup` 3, `cv-apply-replace-race` 8, `cv-profile` 2, `native-application` 1, `jobs-matching` 4, `tailored-cv` 10 | all PASS |
| `npx tsc --noEmit`; `npx vitest run` (apps/web) | PASS; **95 passed** (checkout return: confirms only after the API does, honest "not confirmed yet", mock marked as a test with no polling; pricing disables paid plans when payments are off; settings shows provider status in plain words and the period-end cancellation) |

### Owner actions / open
- **Dodo sandbox rehearsal NOT RUN.** It needs a test-mode key, product ids and a webhook secret. The sandbox run should cover: purchase → webhook → plan shown; cancel in the portal → end date shown → FREE after the period; a failed renewal → on hold → FREE.
- Keep `PAYMENTS_ENABLED=false` in production until that rehearsal passes.
- Known limitation: `EmailService` retries a provider exception up to three times. A timeout after the provider accepted the message could therefore produce a duplicate email. Resend SDK 3.5 has no idempotency key; upgrading it would allow one.

## Prompt 8 — UX/UI polish of the working journeys (28 September 2026)

Branch `claude/ux-polish` (on top of `claude/billing-lifecycle`). No redesign. Established API behaviour is unchanged; one read-only endpoint was added.

### Method
`apps/api/test/ux-audit.ts` runs against a local stack (API `:4010`, web `:3450`) seeded with `test/support/ux-fixture.ts`. The fixture is synthetic and refuses any database other than the local `aise_phase2_test`. The sweep covers 21 routes (public, candidate, employer, operator) at **390, 768 and 1440 px**, with `fonts.googleapis.com`/`fonts.gstatic.com` **blocked** and reduced motion on. Each page gets a full-page and a first-screen screenshot. The script flags:
- horizontal overflow;
- visible icon-ligature words;
- controls without an accessible name;
- targets under 24 px.

The screenshots are kept in the session scratchpad and are not committed.

| Check (63 page × width runs) | Before | After |
|---|---|---|
| Pages with horizontal overflow | 9 (landing 390; candidate applications 390/768; matches 768; employer vacancies/applications 390/768; admin listings 390) | **0** |
| Pages showing raw icon names (`menu`, `arrow_forward`, `check_circle`, …) | 5 (landing at every width; about/contact at 390) | **0** |
| Controls without an accessible name | 76 | **0** |
| Targets under 24 px | 99 | 57 — footer/inline text links and "Şifrəni unutmusunuz?" (spacing exception); the "after" run also skips `sr-only` inputs |

### What changed
- **No icon font.** Every Material Symbols usage (landing page, nav, scan grid, workflow demo) is now a bundled lucide SVG marked `aria-hidden`, and the Google stylesheet link is gone. Before this change, a blocked or slow font request showed the words "menu", "arrow_forward" and so on, and the long words pushed the phone landing page 43 px wide. Unused `FEATURES` data was removed.
- **Layout**:
  - The signed-in `<main>` gets `min-w-0`, so tables scroll inside their card instead of widening the page.
  - Admin scroll containers are `relative`; an `sr-only` label inside them was widening the page.
  - Employer vacancies on phone fold counts under the title so the actions stay visible.
  - The demo card title wraps instead of truncating.
- **Keyboard and screen readers**:
  - Candidate and employer mobile menus have names and `aria-expanded`, and open as a named modal dialog with focus on "close"; Escape closes them.
  - The 26 profile fields, 4 settings password fields, employer icon-only actions ("<vacancy> — redaktə et/dayandır/sil") and the "Bax" links are all labelled.
  - Small action buttons were enlarged: admin rows to 32 px, employer icons and application links to 40 px.
- **Disabled buttons say why**: native apply (select a CV), external-apply consent (lists the missing steps), onboarding step 1 (upload a CV) and employer "Vakansiya yerləşdir" (awaiting approval), each linked with `aria-describedby`.
- **Reduced motion** switches off the page-enter/drawer animations, pulses and hover transitions globally.
- **Four kinds of application, never conflated** (`/dashboard/applications`). `GET /external-applications/mine` is new and read-only; the receipt reference is returned only for a validated receipt.

  | Kind | What the page says |
  |---|---|
  | Sent inside AISE (native) | Employer's status |
  | Via AISE on the employer's site | "Qəbul təsdiqləndi · <ref>" **only** with a validated receipt; "Göndərildi — qəbul təsdiqi yoxdur"; "Çatdırılma təsdiqlənməyib" with "do not resend"; "Sınaq — göndərilmədi"; in progress / failed / expired |
  | Marked by the candidate | "Siz qeyd etdiniz" (AISE did not send it and cannot confirm it), with the source link |

  An external source link is never listed as an application. The page has an honest retry state when nothing loads.
- **Claims**:
  - Removed "Şəxsi hesab meneceri" and "Prioritetli uyğunlaşdırma növbəsi", which have no implementation, plus the meaningless "Standart növbə" lines, from both the pricing page and `GET /billing/plans`.
  - The daily digest is now listed on every paid plan, which is what the code does.
  - The landing step now reads "AISE vakansiyalarına bir kliklə müraciət edin".
  - The animated demo is labelled "nümunə, real məlumat deyil".

### Verification
| Command | Result |
|---|---|
| `npx ts-node --transpile-only test/ux-audit.ts` (before / after) | table above |
| `apps/web`: `npx tsc --noEmit`; `npx vitest run`; `npx next build` | PASS; **100 passed** (new: menu toggle is an SVG with a name and no ligature text; mobile menu is a named dialog with focus and Escape; applications page shows "received" only for a receipt, the resend warning, self-reported separately, retry on failure); build PASS |
| `apps/api`: `npx tsc --noEmit`; `npx jest` | PASS; **379 passed** (`listMine`: scoped, no cancelled rows, reference only with a receipt, no storage paths) |

### Owner decisions (NOT changed)
- The support address on `/contact` (`support@aisehr.com`) and the remaining advertised services (tailored CV on every plan, hourly monitoring) need the founder to confirm before launch.
- Pre-existing lint errors (`no-explicit-any`, `set-state-in-effect`) in untouched parts of the checkout, settings, navs and workflow demo remain; they are not behaviour bugs.

## Prompt 9 — release verification and founder handover (28 September 2026)

Everything is in **`docs/release-2026-10-05.md`**: decisions, dated evidence per check, deployment and rollback procedure, founder checklist, dependency owners and known limitations. `docs/launch-runbook.md` and `docs/launch-e2e-report.md` are marked as superseded; their historical passes were not reused.

Branch `claude/release-candidate` = `claude/ux-polish` + a merge of `origin/main` (`03167f3`). The merge conflicts were resolved in favour of the later decisions. From `main`'s intent: the matches page no longer mentions auto-apply when the server does not offer it, and the profile no longer claims glorri.az auto-apply.

Release hardening added in this pass:
- `GET /health/live` and `GET /health/ready`.
- Bounded BullMQ retention (failed jobs kept 14 days).
- All published ports bound to loopback; parametrised Postgres password; compose health checks; log rotation.
- A `.dockerignore` keeping uploads and `apps/api/.env` out of the build context.
- `deploy.sh`: waits on readiness; refuses to roll code behind applied migrations.
- `backup.sh`: per-file checksums, more tables counted, verification without the private key on the host.
- `restore-test.sh`: checks every file column, compares every checksum, times the restore; fixed a readiness race.
- `scripts/check-health.sh` for cron monitoring.
- `test/founder-handover-browser.ts`.
- `DEPLOY.md` no longer describes the removed restart button or Docker socket.

Not possible in this sandbox, so marked BLOCKED in the report: Docker image builds (Debian mirrors denied, Docker Hub rate limit) and the real CPU matching model (Hugging Face denied).
