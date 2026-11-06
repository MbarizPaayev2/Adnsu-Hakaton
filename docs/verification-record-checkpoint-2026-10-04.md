# Verification record — backend checkpoints 1–6 (exact SHA `0465b19bf3918339f21a70f68d6bed71932b2975`)

Recorded 4 October 2026. Evidence and blocked checks are kept apart on purpose.

## Completed evidence
* **CI on the exact SHA:** both runs `success` (build-and-test) — runs 37151126355 and 37151123688. Earlier green runs on other SHAs are not counted.
* **API unit suite (once, after CP6):** 72 suites, 1,024 tests passed.
* **E2E sweep (all 36 suites, one at a time, isolated `aise_phase2_test`, unique Redis prefix per process):** 31 suites passed. `retention-journey` asserted the old unset Premium price and was updated to the approved catalogue (passes). `cv-profile` is explained below. Two suites are blocked (below).
* **Migrations — the five additive migrations of this checkpoint** (`20261016090000`, `20261016090100`, `20261017090000`, `20261017100000`, `20261017110000`):
  * Fresh disposable database, all 43 migrations: applied, `prisma migrate diff` against `schema.prisma`: no drift.
  * Upgraded disposable database: built at the previous state (38 migrations), legacy rows inserted (users, Limitsiz and Basic subscriptions, base and tailored CVs, a job, a company follow, a delivered e-mail application), then all five applied. Row content of every legacy table was byte-identical before and after (md5 over the rows); `Resume.docKind` defaulted to `CV`; the legacy e-mail application kept its payload hash with no letter columns set; no drift. Fresh and upgraded schemas are identical (`pg_dump -s`, apart from pg_dump's random restrict token).
  * Both scratch databases were dropped; none remain.
* **Web app against the updated shared types:** typecheck clean, 295 unit tests passed.

## cv-profile 401 — diagnosis
The failing assertion was the second upload in the first test answering 401 after the first upload with the same token succeeded. In `SessionAuthGuard` a 401 on a previously valid token means the session row no longer existed (or expired/suspended). Nothing in the product prunes sessions on login or upload (only password change, reset, suspension and logout delete them), and the account was neither suspended nor expired. Re-running the suite alone (3×) and in the failing order (`cv-apply-replace-race` then `cv-profile`, 3×) passed every time, and nothing in this checkpoint touches sessions. The most likely cause is another process using the same shared test database at that moment (ten worktrees of other agents exist; `src/seed.ts` runs `session.deleteMany({})`), but that is **not proven**: the failing run's server message was not captured. The assertion now reports the server's message so the next occurrence distinguishes an invalid session from a real regression. Treated as an unexplained flake until it recurs with that message.

## Blocked checks (prerequisites missing; not run, not claimed)
* `jobs-matching-real-scorer` — needs `AISE_REAL_SCORER_URL` (a running CPU scorer).
* `external-apply-real-worker` — needs the real apply worker with a Linux Chromium (`chrome-linux/chrome`); fails to prepare on this macOS host.
* Real model output quality/cost, live e-mail delivery, payments, the production inventory and the browser journeys with Gemini's frontend are not verified.

## Pending (not done)
Gemini's corrected frontend branch has not been frozen, so no integration review or end-to-end candidate journey (document generation; letter-attachment approval) against the real frontend was run. Those follow its freeze.
