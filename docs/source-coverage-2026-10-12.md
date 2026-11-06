# Vacancy coverage: measured losses, fixes and the audited next candidates (12 October 2026)

All figures are production read-only queries on 11 October 2026 (eligible = ACTIVE, not hidden, not closed, not a duplicate, deadline not passed).

## Baseline
| | |
|---|---|
| Eligible postings / employers | **1,343** / 129 |
| By origin | Glorri 1,196 · ABB 41 · Xsolla (Lever) 39 · PASHA Insurance 35 · SOCAR 19 · Azercell 8 · PASHA Holding 5 |
| Application method | external site 1,086 · unknown 257 · **e-mail 0** |
| Listed again within 48 h (freshness) | Glorri 883 of 1,196; every other source 100% (collected the same day) |

## Losses found and fixed in existing collectors
1. **Glorri never closed anything.** Each of the last 170 hourly runs listed 876 postings completely, but one detail page failed in every run, and the importer skipped closures whenever any detail failed: closed = 0 in all of them. 313 of the 1,196 eligible Glorri postings were not in Glorri's listing for ≥ 48 h (239 for ≥ 7 days, since 30 August), and 332 stored rows carried a deadline that had passed. Fix: closures run when detail failures stay within 2% of the listing; a posting absent from 48 consecutive complete listings (and unseen for 48 h) is closed with reason `not_listed_by_source` (a later listing reopens it); a posting whose deadline passed more than a day ago is closed `deadline_passed`; the baseline listing may be a PARTIAL one. Expected effect: the eligible count falls by the ~313 stale rows on the next runs: that is a correction of freshness, not a loss.
2. **ABB was capped at 50 of 106.** The employer-feed budget (5 pages) stopped ABB's 11-page feed after 50 postings in every run, so 55 postings were never collected and the listing never counted as complete. The employer budget is now 20 pages / 300 postings at the same request spacing (1.5 s). Expected: +~55 ABB postings once the complete run lands.

## New sources (scheduled daily by migration `20261024090000`, audited, no human actor)
| Source | Basis | Result on 11 October (read-only dry collection) |
|---|---|---|
| **Kapital Bank group** (careers.bir.az: Bir, Birbank, m10, Birmarket) | the career site's own public GET endpoints on apihr.kapitalbank.az; no robots.txt published; no terms found | **63 postings, complete listing**, 0 expired; places only from branch names (Bakı 44, Ağcabədi, Qusar, Lənkəran, Quba, Xaçmaz, Qəbələ; 13 country-level) |
| **Yelo Bank** | its own career page; reviewed collector already in the repository | 8 postings, complete |

The source's "region" field is **not** used: it files a Qusar branch under Ağstafa and an Ağcabədi branch under Bakı.

## Audited and not collected (evidence, not a promise)
| Candidate | Finding | Next action |
|---|---|---|
| **Azersun** (azersun.com, careers/hr hosts) | every path, including /robots.txt, answers a Cloudflare "Attention Required" bot challenge | **blocked**: not bypassed; ask Azersun for a feed or an allow-listed agent |
| Kontakt Home, AZAL, BP Azerbaijan | same Cloudflare challenge | blocked, same remedy |
| Bakcell | robots.txt `Disallow: /az`; the list is loaded client-side | needs the endpoint reviewed |
| Bank Respublika, Xalq Bank | branch/contact pages only; no vacancy list found on the paths tried | needs a manual look |
| PASHA Bank, Unibank, Rabitabank, Expressbank, Leobank, Nar, others | the registry or guessed paths answer 404/unreachable | URLs need re-verification (registry entries are stale) |
| Job boards (HelloJob, Work.az, SmartJob, Boss.az, eJob, JobSearch) | read-only review in October: no clause on automated access or reuse, no grant either | **not scheduled** (terms silent is not permission); they are where "send your CV to …@…" postings live |

## E-mail application coverage
**0 of 1,343** eligible postings state an application e-mail. The 49 postings that contain an address are Xsolla privacy/hiring-practice contacts and SOCAR "if questions arise, contact …" lines; none is an application instruction and none is used. The sources AISE collects (official ATS and career sites) route applicants to their own portals, so deterministic extraction has nothing to find; raising this number requires the job-board sources above (permission) or employers that publish an address on their own pages. No address is guessed.

## Job-board access review (12 October 2026, one board at a time, against each site's own published rules)
| Board | robots.txt | Published terms | Decision |
|---|---|---|---|
| HelloJob (`hellojob.az`) | allows all | `/page/qaydalar`: posting rules and CV-pool use only; nothing against reading public vacancy pages | **scheduled** (12 h, board budgets, original links kept) |
| SmartJob (`smartjob.az`) | allows vacancy pages; disallows `/api/` and account paths | `/istifade-sertleri` (6 Sep 2026): no clause on automated access | **scheduled** (12 h) |
| Work.az | allows | user agreement prohibits "automated programs and bots collecting data" | **restricted**, not collected |
| Boss.az | allows `/vacancies*` | `/pages/terms-conditions` 8.3 prohibits access with automatic programs | **restricted**, not collected |
| Busy.az | allows | `/qaydalar` prohibits bots, scraping and databases built from its content | **not collected** |
| JobSite.az | allows | agreement prohibits bots/scrapers/crawlers without written permission | **not collected** |
| eJob, JobSearch | allow (JobSearch: 30 s crawl-delay) | none published | **held** (unchanged since 3 Oct) |
| JobNet | allows | `/rules`: posting rules only | small (6 vacancies on 12 Oct); not worth an adapter |
| JobU | disallows `/job/page/` (its own pagination) | none found | not collected |
