# Official employer coverage expansion — 13 October 2026

Baseline (production, same actionable predicate): 1,663 vacancies across 313 employer names; 15 explicit-email vacancies across 12 employers. Actionable means ACTIVE, hiddenAt null, duplicateOfId null, and no elapsed deadline.

## Reviewed additions

| Source | Official entry point | Bounded live preview | Application route |
|---|---|---|---|
| Avrora | https://www.avrora.az/az/karyera | 2 listed, 2 accepted, complete, 4 requests | Both postings explicitly invite CVs to hr@avrora.az; subject instructions retained |
| AzerGold | https://careers.azergold.az/vacancies | 6 listed, 6 accepted, complete, 8 requests | Employer portal; full dated deadlines and source locations |
| Veyseloglu MMC | https://karyera.veyseloglu.az/home/allvacancies?pageIndex=1&pageSize=5 | 13 listed, 13 accepted, complete over 3 pages, 18 requests including missing-robots redirect | Employer portal; only current list entries, not historical indexed detail pages |

These are 21 source postings, not a proven net increase: cross-source duplicates may already exist. No historical expired pages are promoted into live inventory. Re-query production after release and settled imports to measure the net result.

## Access review

Avrora robots permits the career paths; AzerGold robots allows public paths. Veyseloglu's missing robots file redirects to a genuine public 404, handled only for this reviewed host. Its corporate press release links its career portal (https://www.veyseloglu.az/media/press-release/106). Published privacy information reviewed concerns candidate data; no automation restriction was found. This is an internal access review, not a contractual republication licence: all three remain ROBOTS_ALLOWED_TERMS_PENDING, attributed and removable/pausable on request.

PAŞA Bank is excluded: its terms explicitly prohibit copying/reuse without written permission (https://www.pashabank.az/az/terms-of-use-istifade-qaydalari). Unibank's career page points to its existing Glorri postings, so a second collector adds no unique source coverage. Bank Respublika's inspected career page is informational, not a verified vacancy feed.

## Safety and dates

Only allowlisted public GET list/detail/robots paths are requested; no account, save, apply or submission endpoint. Requests retain source spacing and robot crawl-delay; 403/429 abort immediately. Validation failures, repeated paging, count mismatch or budget exhaustion cannot authorize closures. The existing source leases, duplicate linking and two-complete-miss lifecycle apply unchanged.

Publication dates absent from all three sources are explicitly marked first-observed. Ingestion retains the original observation date on future refreshes rather than making an old vacancy look newly published. Veyseloglu's deadlines omit a year: preserve source day/month text and set deadlineYearUnknown instead of inventing an ISO date. Current-list membership confirms presence; eventual removal uses complete-list reconciliation.

Migration 20261029090000 adds three daily schedules and release audit rows. It never overrides existing restricted/paused source rows (ON CONFLICT DO NOTHING). Include avrora, azergold and veyseloglu in the host health allowlist before normal monitoring resumes. Code rollback must pause these new schedules first; it cannot undo an additive source-row migration automatically.

## Existing HelloJob coverage repair

The latest production run could not parse any of 200 detail pages. A bounded public HTTP 200 probe reproduced the failure: HelloJob replaced the company__body layout with section.vp[data-advert-root]. The parser now supports both layouts, checks the vacancy identity, reads publication/deadline/city metadata, and takes only vp__text as the description. Sidebar contacts, hidden apply endpoints and source promotions remain excluded. A genuine public detail was parsed successfully; two synthetic regressions cover extraction and identity/date rejection. The next lease-protected import must establish the actual recovery yield.

## Validation

Targeted tests: URL restrictions, footer/form exclusion, genuine application e-mail vs contact address, dates/cities, date-year ambiguity, repeated mobile links, incomplete counts, robot prohibition/crawl delay, 403/429 abort, missing robots redirect, repeated pagination and first-observation stability. The initial 43 targeted tests passed; the expanded parser/collector/ATS registry set passed 88 tests. Full CI initially identified that local employer collectors must be excluded from the ATS-only registry assertion; that assertion is now corrected. Typecheck passed. Full exact-head/merge CI and exact-image/server preview are required before release.

No employer was contacted, no application submitted and no manual recommendation email sent.
