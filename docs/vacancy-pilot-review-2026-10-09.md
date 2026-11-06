# Vacancy-collection pilot — review, source terms evidence and activation plan (9 October 2026)

Status: **prepared, NOT activated.** Production collects only Glorri through its own hourly importer. `SOURCE_SCHEDULE_ENABLED` is unset, all 21 other sources are `scheduled=false`, no pause flag is set (checked read-only on 9 Oct).

## 1. What was integrated from `codex/vacancy-growth`
The branch adds three files on top of what `main` already contains (the scheduler, leases, discovery progress, cooldowns and coverage were merged and deployed with PR #16): `apps/api/test/canary-live-collection.ts` (a live canary run through the real `SourceScheduler`), a small edit of `scheduler-acquisition-trial.ts`, and the report `…pilot-report-2026-10-07.md`. Both commits were cherry-picked unchanged (history preserved, no production code). Its central claim — only a source with `scheduled=true`, not paused, not restricted, not `glorri`, not in cooldown and not leased can be claimed — was checked against `SourceScheduler.claim()` in `main` and holds.
**Counts in that report come from an isolated acquisition database (`aise_census_growth_test`), not from production.** Production on 9 Oct: public catalogue 1,239 (all Glorri). Do not quote the 1,755 figure as AISE's inventory.

## 2. Verification (what was re-run, and what is evidence from earlier work)
| Requirement | Evidence |
|---|---|
| Persistent discovery progress, restart recovery, resume | Re-run on 9 Oct against the isolated test database: `source-scheduler` (7), `source-lease` (12), `source-coverage` (11), `source-schedule-queue` (2), `source-automation` (31) e2e tests and `src/jobs` unit tests (96): all passed. The earlier real-collector trial with `SIGKILL` recovery is in the pilot report (stand-in time and a private database, not production) |
| Leases across scheduled and manual runs | `source-lease` e2e (second holder, wrong token, run-now refused while held, release) |
| Bounded requests, source intervals, cooldowns | Scheduled limits `maxPages 12 / maxJobs 200 / delayMs 2000`; interval and failure back-off per source (`nextRunAfter`); 24 h cooldown after a block, doubling to 7 days; one probe after cooldown |
| No closure after partial, failed, blocked or interrupted runs | `source-coverage` e2e; closure needs 2 consecutive verified-complete listings |
| Global and individual pause | `PUT /admin/ops/scheduler/pause` (`import.scheduled`) and `PUT /admin/ops/sources/:key/schedule` `{paused}`; Glorri has its own flag `import.glorri` and the env `GLORRI_SCRAPER_ENABLED`. **Not flipped in production** (the founder keeps Glorri running) |
| Production allowlist | Verified live: only `glorri` is `scheduled`; the health monitor now alerts on any other scheduled source |
| Operational alert | `check-health.sh` (cron, every 15 min, e-mail through the working Resend key): stale scheduled source, cooldown, scheduled source outside the allowlist. One real alert e-mail was sent on 9 Oct (accepted by Resend; mailbox receipt not yet confirmed by the founder). **Schedule-aware (this change):** a source may go `2 × interval + 60 min` without a finished run, so a daily source is not alarmed after 6 hours; hourly Glorri (`SOURCE_HOURLY_KEYS`) 3 h; checked against production data (normal run OK; Glorri treated as a daily source OK; forcing 0 h raises the alert text) |

## 3. Source review (official sources, 9 Oct 2026)
**PAŞA Sığorta (`career.pasha-insurance.az`, Teamtailor RSS `/jobs.rss`).**
* `robots.txt` of the career site: `Disallow` only for `/app/`, `/messages/`, `/messenger/`, `/facebook/tab/`, `/jobs/internal/` (and everything for the bot `aihitdata`); `Content-Signal: search=yes, ai-train=no, ai-input=yes`. `/jobs.rss` is not disallowed.
* Teamtailor's own help article presents the RSS feed as a way to share vacancies in other channels (it names LinkedIn job wrapping). It does not address aggregators or scraping, and no Teamtailor terms on automated access were found.
* The employer's website *İstifadəçi Razılaşması* §6 says site content belongs to PAŞA Sığorta and copying or reprocessing it without permission is prohibited; it says nothing about vacancies or automated collection, and the career site is a separate (Teamtailor) site.
**Xsolla (`jobs.lever.co/xsolla`, Lever public JSON).**
* Lever's Postings API page describes the API as designed "to help you create a job site", gives no terms or attribution requirement, says published postings are public and "may be scraped by third parties", and gives no limit for GET requests. The registry note records `robots.txt` allows `/` with a 1 s crawl-delay.
**What this does and does not establish.** Technical access is public and crawler directives do not forbid the feed. That is **not** a licence to republish the employers' text, and nothing here marks the sources `TERMS_REVIEWED_ALLOWED`: both stay `ROBOTS_ALLOWED_TERMS_PENDING`. No source was contacted for this review beyond reading public pages.

## 4. Decision needed from the founder (business, not technical)
Whether AISE may show these employers' vacancy text on its site while linking to the employer's own application page with attribution. The lowest-risk path is **written permission** from PAŞA Sığorta's HR contact (Xsolla's recruiting team for the second source). Draft to send from the AISE mailbox (not sent by the engineer):
> Subject: Permission to list PAŞA Sığorta vacancies on AISE (aisehr.com)
> Hello, AISE (aisehr.com) is an Azerbaijani job-search platform. With your permission we would show the titles and descriptions of vacancies you publish on career.pasha-insurance.az, always with the PAŞA Sığorta name and a link to your own application page, and we would refresh or remove them automatically when you close them (about once a day, one request, from the public RSS feed). Candidates always apply on your page. May we do this? We will remove anything on request within one working day. — [name, role, phone]

## 5. Pilot configuration (activate only after the decision above)
1. `PUT /admin/ops/sources/pasha-insurance/schedule` `{scheduled:true, intervalMinutes:1440}`; the other 20 stay unscheduled (the health monitor alerts if one is scheduled by mistake).
2. Set `SOURCE_SCHEDULE_ENABLED=true` in `apps/api/.env` and recreate only the API (release id preserved); the tick runs every 10 minutes and claims at most the one due source.
3. Watch: `/admin` → Mənbələr, `JobImportRun`, `check-health` (stale alert after 2 × 24 h + 60 min, cooldown alert immediately). A real scheduled run is proven when a `JobImportRun` for the source starts by the scheduler tick (not run-now), finishes, and `nextRunAt` moves 24 h on.
4. Rollback / pause in seconds: `PUT /admin/ops/scheduler/pause` (global) or the source's pause; hard stop: remove `SOURCE_SCHEDULE_ENABLED` and recreate the API. Imported postings stay visible until a verified-complete listing drops them; they can be hidden per listing in admin.
5. Xsolla as a second source only after a clean week for PAŞA Sığorta and its own decision.
**Counts to report after activation:** production (public catalogue, per source: unexpired / verified-complete today / freshness unknown) separately from any isolated-database figures; "unexpired" is not "verified open today".
