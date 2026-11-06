# Xsolla-only collection pilot — evidence, verified prerequisites and the exact activation plan (9 October 2026)

Status: **prepared, NOT activated, awaiting the founder's decision.** PAŞA Sığorta stays pending permission; nothing was sent to either company.

## 1. Source evidence (official pages, read 9 Oct 2026)
| | Finding |
|---|---|
| Collector | `public-lever-json-api`: one GET of `https://api.lever.co/v0/postings/xsolla?mode=json`, postings with a stated Azerbaijani location only (the feed lists all global roles; about 40 are Baku, the rest are filtered out) |
| `jobs.lever.co/robots.txt` | `User-agent: *`, `Allow: /`, `Crawl-delay: 1`; no Disallow, no Content-Signal |
| Lever Postings API page | designed "to help you create a job site"; no terms, no attribution requirement, no stated GET rate limit; says published postings are public and "may be scraped by third parties" |
| Xsolla's own terms | the careers pages carry no copyright or reuse statement that could be retrieved; Xsolla's general website terms (Terms and Conditions of Sale) say site content may not be copied or republished without written consent, and its job-applicant privacy notice covers applicant data only. Whether those general terms govern the Lever-hosted postings is **not established** |
**Conclusion.** Technically public and not disallowed, and Lever itself treats postings as scrapable; but nothing here is a licence to republish Xsolla's text, so the source stays `ROBOTS_ALLOWED_TERMS_PENDING`. That is a business decision, not a technical one.

## 2. Decision requested
* **A (recommended): ask first.** Send the e-mail below to careers@xsolla.com from the AISE mailbox; activate only on a yes (or after a week without objection if you accept that risk).
* **B: activate now** on the public-feed basis, knowing the general-terms wording above; pause and hide on any objection.
Draft (not sent): "Subject: Listing Xsolla's Baku vacancies on AISE. Hello, AISE (aisehr.com) is an Azerbaijani job-search platform. With your permission we would show the title, description and location of the Baku vacancies you publish on jobs.lever.co/xsolla, always crediting Xsolla and linking to your own application page, refreshed once a day from the public feed (one request) and removed when you close them. Candidates apply on your page. May we? We remove anything on request within one working day. — [name, role]"

## 3. Prerequisites verified (read-only, production, 9 Oct)
* Deployed API image `b832983d836e` contains the Lever collector and the 101-employer registry; all 47 migrations applied; Redis answers `PONG`; the API container resolves `api.lever.co` (no request was made to Lever).
* Registry row `xsolla`: enabled, **not** scheduled, `ROBOTS_ALLOWED_TERMS_PENDING`, interval 1,440 min, no cooldown, no lease, not paused; 0 imported jobs, 0 runs. `SOURCE_SCHEDULE_ENABLED` is unset; no pause flag is set; only Glorri is scheduled.
* **Allowlist isolation** (real `SourceScheduler` against a *copy* of the production registry, scheduler enabled): nothing is claimed before scheduling; with only `xsolla` scheduled only `xsolla` is claimed (13 other enabled sources stay unclaimable); claiming stops under the global pause (`import.scheduled`), the per-source pause, a cooldown, and a lease held elsewhere (`apps/api/test/pilot-isolation-check.ts`).
* **Schedule-aware alerts:** `check-health.sh` allows a scheduled source `2 × interval + 60 min` (2,940 min for a daily source; Glorri 3 h) before alarming, alarms on cooldown and on any scheduled source outside `SOURCE_ALLOWLIST`; checked against production data. The alert path delivers e-mail (7 Oct test received; a 9 Oct alert test was sent, receipt to be confirmed by the founder).
* Re-run on 9 Oct: scheduler, lease, coverage, schedule-queue and automation e2e suites (63 tests) and the jobs unit tests (96) pass.

## 4. Exact activation plan (after approval; about 15 minutes)
1. **Admin → Mənbələr → xsolla:** turn the schedule on, interval 24 h (API: `PUT /admin/ops/sources/xsolla/schedule {"scheduled":true,"intervalMinutes":1440}`); the founder does this in the admin screen (the engineer does not use the founder's login for it).
2. **Host:** add `SOURCE_SCHEDULE_ENABLED=true` to `apps/api/.env` (mode 600, backup first) and recreate only the API with the release id preserved (`RELEASE_SHA=<running sha> docker compose up -d --no-deps api`).
3. **Alert allowlist:** `SOURCE_ALLOWLIST=glorri,xsolla` into the 15-minute health cron (`install-ops-cron.sh --apply` with that variable; the current cron line keeps `glorri` only until then, so an unplanned second source would alarm).
4. **Prove a real scheduled run** (within 10 minutes: the tick runs every 10): a `JobImportRun` for `xsolla` started by the scheduler tick (not run-now), finished `SUCCEEDED`/`PARTIAL` with `listingComplete`, `nextRunAt` moved 24 h, about 37–40 Xsolla postings in `/jobs`, source attributed to Xsolla with the employer's application link. Budgets: one feed request, at most 12 pages / 200 jobs / 2 s delay.
5. **Report counts separately:** production catalogue before/after, Xsolla unexpired vs verified-complete today, and any isolated-database figures (never mixed).
**Stop / rollback (seconds):** pause the source or `PUT /admin/ops/scheduler/pause`; hard stop: remove `SOURCE_SCHEDULE_ENABLED` and recreate the API. A block (403/429) puts the source in a 24 h cooldown by itself and raises the alert. Imported postings stay visible until two verified-complete listings drop them; on request they can be hidden one by one in the admin screen today; a one-step hide of a whole source is **not built** (a small audited script would be needed if the founder wants that before activation).
**Not part of this pilot:** PAŞA Sığorta (needs permission), any other source, Glorri changes.
