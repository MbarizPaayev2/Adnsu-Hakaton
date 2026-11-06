# Release handoff — documents/e-mail applications + vacancy automation, integrated (4 October 2026)

The single current handoff for PR #16 (the deployment plan, the reconciled earlier gates, the merge sequence and the blockers are in `release-readiness-and-deployment-plan-2026-10-04.md`) (`codex/vacancy-email-applications`, draft, base `codex/employer-source-coverage`). It supersedes `vacancy-growth-integration-plan-2026-10-04.md` (kept for history). **Nothing is deployed or merged to `main`; every production schedule, payment and live application e-mail stays off.**

**What this branch is now.** PR #16's ancestry is unchanged: `15ed077` (document branch) is the first parent of the merge commit `87fccd1`, which brought in `codex/vacancy-growth` (`651dc21`: Work.az/Boss/SmartJob/Xsolla acquisition, the scheduler, the source lease, durable coverage, cooldown). The commits after it are the integration fixes below. The exact pushed head and its CI result are in the hand-off message that accompanies this file; this file does not quote its own SHA.

## 1. What changed in the integration (semantic, not textual)
The merge itself had no textual conflicts and the two sides touch disjoint files. Verifying the merged tree in a real browser found three problems that no unit test on either branch could, all fixed here with tests:
1. **An unavailable source could look healthy.** A source with a `RESTRICTED` access review, a scheduled source whose runs had stopped, and a manual source with an old success all showed "Sağlam". Now: `RESTRICTED` ("Məhdudiyyət var"), `OVERDUE` ("Gecikib": last run older than two intervals), a manual source reads "Hazırdır" with "only updated by hand; may be old", a failed last run stays "Xəta var" even after an operator resets the failure counter, and "Sağlam" requires a **scheduled** source with a **recent** successful run. The completeness label no longer calls a healthy bounded run "failed".
2. **A stale registry count** in the admin e2e (100/9; the registry is 101/10 with Xsolla): it now freezes the original 100/9 and derives the declared, verified additions.
3. **The browser journeys could not run** on a symlinked `node_modules` (Turbopack): the integration stack now gives Next its own `node_modules` and uses Webpack for its dev server. The production build works with both Webpack and the default bundler.

## 2. Evidence (integrated tree, this session; synthetic data; nothing left the machine)
| Check | Result |
|---|---|
| Merge | no conflicts; PR #16's head is the first parent |
| `tsc` (API build config, web), `nest build`, `next build` (Webpack and default) | PASS |
| API unit | **1,166** passed (78 suites); web **380** (58 files); CV PDF **9** |
| API e2e, sequential, isolated databases | **360 passed in 38 suites + 10 in the lifecycle suite (its own database)**; the real apply worker suite ran against a local fixture ATS with Chrome for Testing. `jobs-matching-real-scorer` **not run** (needs `AISE_REAL_SCORER_URL`, i.e. the real model). One timing-sensitive test, `admin-access` "invites an operator…", failed once in the final pass (a TOTP code reused within the same 30-second step) and passed 3 of 3 reruns and in the first full pass; I did not change it |
| Browser journeys (real Next.js + API + Postgres + Redis + document worker + Typst + e-mail sink), documents | **19** passed: career evidence (precision, retry, delete); document generation stays PENDING while the provider is delayed; factual review, edit, manual approval, PDF equals the approved snapshot hash; letter flow and failed-save handling; lost-answer replay (one document, one charge); another candidate gets 404; e-mail application with recipient evidence, CV and letter attached, **the sink received the approved CV and letter byte for byte and the payload hash was recomputed from the stored bytes**; a CV re-approved after preview blocks sending; provider acceptance/delivery worded as exactly that; responsive layouts |
| Browser journeys, sources (`test/integration-sources-journeys.ts`) | **5** passed: **leases** (unleased ingest, confirm-listed and run recording refused for a collector source; second holder, wrong token and operator run-now refused; holder writes; release closes again; a non-collector source not gated); **catalogue** (7 stored, 3 shown; expired, hidden, duplicate and closed absent from the public API and page; admin open count uses the same predicate and reports the excluded apart); **health matrix** (13 states, only the healthy control reads "Sağlam"); **admin controls** (no buttons for restricted/disabled, pause/resume, cooling-down run disabled and recovery audited, run-now against a held source shows the server's refusal); **permissions** (SUPPORT reads, has no controls, and run-now/recover/pause/global pause answer 403) |
| Migrations on disposable databases (`scripts/rehearse-migration-upgrade.sh`) | **fresh:** 46/46 applied, no drift, new columns present, Xsolla registered enabled and **not scheduled**, no source scheduled except Glorri's importer. **Upgrade of a read-only copy of the founder preview database** (43 → 46; documents, approved snapshots, allowance charges, an application) and **of the older census database** (32 → 46; 2,248 postings, applications with verified payload hashes): every pre-existing table is identical (row count and content hash, compared on the columns and sources that existed before), no drift, and the integrated code reads documents, allowance usage (reserved + committed units) and application snapshots (payload hashes recompute) |
| Rollback boundary at the data layer | the previous release's own Prisma client (the document branch's generated client) reads and writes both upgraded copies; rows it writes take the new columns' defaults |
Logs are kept outside Git in `~/aise-preview/integration-evidence/`.

**What this evidence is not.** Document generation used the loopback fixture provider (it restates the facts it is given); it says nothing about real-model quality, language or cost. Scores came from the fixture scorer. E-mail went to a capture sink: no delivery, DKIM or bounce behaviour was exercised. The real scorer, the real model evaluation, other browsers/devices, screen readers and human review of PDF typography are not covered. The vacancy sources were contacted only in the earlier two-source acquisition trial (see the automation document), not in this integration.

## 3. Configuration
No new secret or service. Defaults are safe; nothing needs setting for the release.
| Variable | Meaning | Release value |
|---|---|---|
| `SOURCE_SCHEDULE_ENABLED` | registers the scheduler tick; exactly `true` enables; anything else registers none and removes an existing one | **unset / false** |
| `SOURCE_SCHEDULE_TICK_PATTERN` | `*/N * * * *`, N = 1–59 | unset (every 10 minutes if ever enabled) |
| `PAYMENTS_ENABLED`, `EXTERNAL_APPLY_LIVE_ENABLED`, live e-mail provider settings | as in the document branch | **off** |
| Per-source `scheduled` (admin → Mənbələr) and the `import.scheduled` global pause | operator controls | all sources unscheduled; Glorri keeps its own importer |
Enabling collection needs a decision outside this release: terms-of-use review of each source (all are `ROBOTS_ALLOWED_TERMS_PENDING`) and an alert destination (none is configured; a cooldown is visible only in the admin and in the `source_cooldown_started` log line).

## 4. Migrations (apply with `prisma migrate deploy`, before the new code)
**Correction:** production is at **21** migrations (as last recorded, 30 Sep), so **25** apply: 2 from PR #12, 23 from PR #16. The three below are only what the growth branch added on top of the document branch. A **21 → 46** upgrade of a synthetic legacy database with `main`'s schema was rehearsed (every pre-existing table identical; the Glorri-payload backfill set Remote on 5 and an experience level on 8 of 40 jobs; `main`'s own Prisma client reads and writes the result). Only `20261005090000_source_registry_and_job_facts` changes existing rows (backfill); the other data statements register or hold sources. All DDL is additive. The three growth migrations, ordered after the document branch's last (`20261017110000_observed_company_profile`):
1. `20261017120000_register_xsolla_lever`: registers the `xsolla` source (enabled, unscheduled); idempotent.
2. `20261018090000_source_run_coordination`: `JobSource.leaseOwner, leaseHeartbeatAt, cooldownUntil, cooldownReason, cooldownCount`; table `SourceDiscoveryProgress`.
3. `20261018100000_discovery_head_fit`: `SourceDiscoveryProgress.headReachedEnd`.
No existing column or row is altered or dropped. Do not run the rehearsal script against a production database: it only reads the databases you name (pg_dump) and works on copies, but run it only where you intend that.

## 5. Lease requirements for existing callers
For the sources that have a reviewed collector (`work, hellojob, boss, smartjob, ejob, jobsearch, abb, pwc, socar, azercell, ey, halliburton, yelo, xsolla, …`), the internal routes `POST /internal/jobs/ingest`, `/confirm-listed` and `/import-runs` now answer **409 without a valid lease** (`x-source-lease`).
* The import CLI (`script:import-public-jobs … --apply`, including the one shipped in the API image) takes, renews and releases the lease itself; operators change nothing. Without `--apply` it only previews and takes no lease.
* **Any other caller** that posts to those routes for such a source (a custom script, an old cron) must take a lease first (`POST /internal/jobs/source-lease`, `action: acquire|renew|release`, same service token) or use the CLI. Found in the repository: none besides the CLI; `scripts/rehearse-rollback-compat.sh` and the preview seed use `glorri:` / `preview:` ids, which are not gated.
* Glorri (own importer) and sources with no reviewed collector are not gated.

## 6. Rollback
* **Code:** redeploy the previous images (PR #16's earlier head). Migrations are **not** reverted: they are additive and the previous code ignores the new columns and table (checked with the previous release's own Prisma client, section 2). The `xsolla` row stays, enabled but unscheduled.
* **Scheduling off, fastest:** unset `SOURCE_SCHEDULE_ENABLED` and restart (the tick is removed on startup), or set the global `import.scheduled` pause in the admin (takes effect without a restart). Run-now and recovery are refused while paused.
* A source stuck "running" after a crash recovers by itself when its 45-minute lease expires; an operator can use "Bərpa et".
* After rolling back the code, there is no lease: nothing enforces non-overlap, but nothing schedules either.
* Not rehearsed: the full image-level rollback (`scripts/rehearse-rollback-compat.sh` needs built images, a Redis binary and the real scorer, none of which were available). The data-layer boundary above is the part that was proven.

## 7. Known limitations
* No outbound alert channel for cooldowns; large boards (Work.az, HelloJob, Boss, SmartJob) never close postings (no run can prove completeness); only two sources were run live, briefly; content-only detail failures are tolerated only for collectors that report them. Details: `source-scheduling-automation-2026-10-04.md` section 8.
* The founder preview database and its dependencies were not migrated or touched (the migration rehearsal only read a copy of it).
* PDF typography in the four languages, other browsers/devices and screen readers have not had human review.

## 8. Smallest remaining release checklist
1. Founder: review and take PR #16 out of draft; confirm CI green on the exact final head.
2. Decide whether the real-model/scorer evaluations gate this release (they are not run; live-provider readiness is "no").
3. Deploy: the API applies the 25 pending migrations when it starts (46 in total), then the new images; confirm `/health/ready`; keep `SOURCE_SCHEDULE_ENABLED` unset, payments and live e-mail off.
4. Smoke after deploy (read-only): the admin sources page shows every source as Hazırdır/Söndürülüb/Məhdudiyyət var, none scheduled; the public catalogue count matches the admin open count.
5. Later, separately: terms review and alert destination, then enable one low-risk source (an employer feed) and watch the logs before any large board.
