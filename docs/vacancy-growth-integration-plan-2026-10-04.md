# Integrating the vacancy-growth branch with the document branch — plan (4 October 2026)

> **Superseded** by `release-handoff-integrated-2026-10-04.md`, which records the integration as done and verified. Kept for history.

Nothing here has been merged, deployed or enabled. This is a plan with the checks already done; the merge itself, any deployment, any production schedule and the browser extension are decisions for the founder.

* Growth branch: `codex/vacancy-growth` at the commit that contains this file (earlier heads `e47802e`, `0714159`, `3751796` passed CI; the CI result for the final head is recorded in the hand-off).
* Document branch: `codex/vacancy-email-applications`, last seen at `15ed077`. Merge base `12e3570`. The document branch has 3 commits not in growth (letter style, CV/resume guidance, pilot hardening: 31 files, no schema change); growth has 13 commits not in the document branch (Work.az/Boss/SmartJob acquisition, Xsolla, scheduler automation, lease, coverage, cooldown, trial).

## 1. What was verified about the merge (scratch worktree; the document checkout and the founder preview were not touched)
A scratch worktree merged `origin/codex/vacancy-email-applications` into the growth head **without committing**:
* **No textual conflicts** (the two sides touch disjoint files: documents/resumes/career/web document pages on one side; jobs/scrapers/admin sources/scheduler on the other).
* `tsc -p tsconfig.build.json` clean. API unit suite **1,151 passed** (77 suites; growth alone 1,088 + the document branch's additions). Scheduler/lease/coverage/queue e2e **63 passed** on the merged tree. Web suite **379 passed** (58 files).
* **Not verified on the merged tree: the browser integration journeys** (`test/support/integration-stack.ts` + `documents-integration-journeys.ts`). The scratch worktree links `node_modules` from the growth checkout, and Next's Turbopack refuses a symlinked `node_modules` ("points out of the filesystem root"), so the stack did not start. Run them after the merge in a real checkout (section 5). My own leftover database from that attempt was dropped.
* `tsc -p tsconfig.json` (which includes specs) reports about 20 typing errors in spec files on both sides; they are unchanged by the merge and jest does not type-check them.

## 2. Migrations
Order is already correct, no renumbering is needed. Document branch ends at `20261017110000_observed_company_profile`; growth adds, strictly later:
1. `20261017120000_register_xsolla_lever`: inserts/updates the `xsolla` source row (enabled, `scheduled=false`, access review `ROBOTS_ALLOWED_TERMS_PENDING`). Data only; idempotent (`ON CONFLICT DO UPDATE`).
2. `20261018090000_source_run_coordination`: **additive**: `JobSource.leaseOwner, leaseHeartbeatAt, cooldownUntil, cooldownReason, cooldownCount` (default 0) and the new table `SourceDiscoveryProgress` (FK to `JobSource`, cascade).
3. `20261018100000_discovery_head_fit`: `SourceDiscoveryProgress.headReachedEnd BOOLEAN` (nullable).
No existing column or row is altered or dropped; `prisma migrate diff` showed no drift for the growth schema; the document branch changed no schema file since the merge base. `migrate deploy` is the only command needed. Rolling back the application code leaves the new columns unused and harmless.
**Test databases:** suites that insist on a named database need the three migrations applied: `aise_phase2_test` already has them (applied during this work); `aise_lifecycle_isolated_test` is used for `confirm-listed-lifecycle` only. Do not point any suite at a shared or preview database.

## 3. Configuration
| Variable | Meaning | Default / required action |
|---|---|---|
| `SOURCE_SCHEDULE_ENABLED` | Registers the repeating scheduler tick. Exactly `true` enables it; anything else registers nothing and removes an existing tick | **Leave unset/false** until the founder authorises collection (below). Added to `apps/api/.env.example` |
| `SOURCE_SCHEDULE_TICK_PATTERN` | How often the scheduler looks for a due source: `*/N * * * *`, N = 1–59 | Optional; default every 10 minutes; anything else is ignored |
| Per-source `scheduled`, interval, pause | Admin → Mənbələr (needs `ops.control`) | All sources are unscheduled today (Glorri keeps its own importer and is never claimed) |
| `import.scheduled` feature flag | The global emergency pause (Admin → Operations) | Unchanged |
No new secret or external service is introduced. **No outbound alert channel exists** (only the admin recommended actions and logs); adding one needs the founder's decision and a destination.

## 4. Operational changes the merge brings
* **The manual import CLI now needs `--apply` to write and takes the source lease.** Any script, cron or runbook that imported collector sources through the internal routes **without** the lease header is refused (HTTP 409) for those sources. Update such callers together with the deployment (the CLI in this branch already does it). Glorri (own importer) is unaffected.
* New admin endpoints (`ops/sources/:key/run-now`, `…/recover`, `ops/scheduler/pause`) and UI buttons; all audited and permission-gated, nothing runs by itself.
* Test helpers: `test/support/source-lease.ts` (`TestLeases`) must be used by any test that imports collector-source postings through the routes; `integration-stack.ts` registers a synthetic source `integ` for the document journeys (`integ:` prefixes) so they do not depend on a real collector key. Document-branch e2e suites that import postings under a real collector key would need the same treatment; the document branch's e2e suites were **not** run on the merged tree (they need their own named databases), so check this when step 2 of section 5 runs them.
* The shared-`node_modules` caveat from the earlier setup stands: in a checkout that symlinks `node_modules` to another one, `prisma generate` would overwrite the other checkout's client. The growth checkout has its own `.prisma`/`@prisma`; the document checkout and the founder preview use the older client and need `prisma generate` only when their own checkout is migrated.

## 5. Recommended sequence (each step reversible until the last)
1. **Founder decision** on merge direction: merge the document branch into growth (clean, already rehearsed) or the reverse; either gives the same tree.
2. In a **real checkout** (not the preview's): merge, `npm ci` if needed, `prisma generate`, run unit + web suites, then the migrations on a **fresh disposable database** (`migrate deploy`) and the scheduler e2e suites.
3. Run the **browser integration journeys** (`integration-stack.ts`, then `documents-integration-journeys.ts all`) on the merged tree. This is the only check section 1 could not do.
4. Optionally rebuild the founder preview from the merged tree into a **new** database (`aise_preview_<date>`) so the current preview stays available; do not migrate `aise_preview_20261004` or `aise_local_preview_20261003` in place.
5. Open one PR for the merge; require CI on its exact head.
6. **Only after review, and separately**: deployment (migrations first, then code), and only then the collection decisions below. The migrations alone change nothing at run time: every schedule is off.

## 6. Before any production collection (not part of the merge)
* Review each source's terms of use (all are `ROBOTS_ALLOWED_TERMS_PENDING`) and attribution rules; record the review in the admin.
* Decide the alert destination for cooldowns.
* Enable one low-risk source (an employer feed such as Xsolla) with `SOURCE_SCHEDULE_ENABLED=true` and watch `source_collection_*` / `source_cooldown_started` logs for a few days before any large board. Large boards (Work.az, HelloJob, Boss, SmartJob) will never close postings by design (see the automation document, limits); plan their expiry through deadlines.
* The browser extension is a separate decision and was not started.

## 7. Risks and unknowns
* Browser journeys on the merged tree: not run (section 1).
* The acquisition trial covered Work.az and Xsolla only, briefly, with compressed time; the other collectors have not run live under the scheduler.
* A merge conflict may still appear if the document branch moves again before the merge; re-run the dry merge (`git merge-tree --write-tree`) first.
