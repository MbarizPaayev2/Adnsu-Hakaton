# Azerbaijani employer vacancy coverage

Checkpoint: 1 October 2026. Work is on `codex/employer-source-coverage`, stacked on the Hellojob/ABB collector branch in draft PR #13. It is not merged, deployed or scheduled. **The 100-employer request is not complete: six targets have adapters, and 94 still need source-specific integration.** The audit covers all 100 targets but does not count them as scraped.

The register in `apps/api/src/scrapers/public-jobs/employers-100.json` includes SOCAR, Azercell, PASHA companies, Deloitte, EY, PwC, KPMG, McKinsey, BCG and Bain, plus energy, banking, technology, aviation, retail, construction and hospitality employers. This is a curated coverage list, not a verified ranking of the country's 100 largest companies. Candidate websites, local operations and current openings still need verification where marked. Group subsidiaries are separate targets; a parent group's job is not automatically assigned to a subsidiary.

## Working collectors and live read-only evidence

| Target | Public source | Preview result | Boundary |
| --- | --- | --- | --- |
| SOCAR | [SOCAR jobs](https://jobs.socar.az/search/) | 34 discovered, 34 fetched, 34 accepted, 4 pages, 0 expired, 0 failures | Entire observed search result; not proof of every SOCAR subsidiary's recruiting channel |
| Azercell | [Azercell tenant](https://careers.digitalecosystem.az/Azercell/search/) | 15 discovered/fetched, 14 accepted, 1 rejected, 1 page | Incomplete: one description exceeds AISE's 20,000-character limit; that listing also has contradictory deadline text. It is not truncated/imported |
| PwC | [PwC Azerbaijan jobs](https://jobs-cee.pwc.com/ea/en/search-results-azerbaijan) | 3 discovered/fetched/accepted, 1 page, 0 failures | Entire observed Azerbaijan result. Extra pagination is not yet verified: a larger total than embedded rows makes a run incomplete |
| Halliburton | [Halliburton Azerbaijan search](https://jobs.halliburton.com/search/?q=&locationsearch=Azerbaijan) | 1 discovered/fetched/accepted, 1 page, 0 failures | Source metadata must explicitly identify Azerbaijan; foreign jobs are excluded |
| EY | [EY Baku search](https://careers.ey.com/ey/search/?q=&locationsearch=Baku) | Explicit 0 results, 1 page, no parsing failures | Only this endpoint/filter; not proof that EY has no Azerbaijan openings through other channels such as its Yello board |
| ABB | [ABB careers](https://careers.abb-bank.az/vakansiyalar) | Earlier PR #13 preview: 104 rows, 44 expired, 60 non-expired over 11 pages | Existing collector retained; country-only location is preserved when no explicit city is supplied |

SOCAR/Azercell/EY/PwC observations completed at `2026-10-01T19:01:03.572Z`. Results are public source postings, not proven additional unique AISE jobs. Existing Glorri overlap is checked through the normal guarded ingestion/deduplication path when an import is actually authorized and run. No source jobs were written to local or production databases in these previews.

Sources are collected with CPU HTML/JSON parsing, without an LLM, GPU or paid API. These new sources use the existing preview-first CLI. Runtime collectors do not need Chrome; a disposable browser was used only to establish PwC's public link/search contract during development.

## Data and collection guarantees

- Shared SAP careers parser uses source JobPosting microdata, original URLs, publication instants and deadlines. SOCAR's city-only street metadata and the explicit Salyan district in its title are supported. Locations are not guessed from the employer's headquarters.
- Azercell is constrained to its verified `/Azercell` tenant. The ecosystem's root search includes other employers and is not relabelled as Azercell.
- Global employer rows need explicit Azerbaijani country/city evidence. The US state abbreviation `AZ` on a Phoenix address is excluded.
- PwC parses a public JSON literal and full JobPosting metadata; it never executes downloaded JavaScript. It verifies source/job identity, canonical link, country, external visibility and OPEN status. Only minimal stable vacancy metadata is retained, not session/configuration fields or recruiter names.
- PwC's current source provides no application deadline. None is invented. Before any scheduled rollout, closure/freshness handling for deadline-less jobs must be completed: skipping a closed/disappeared source row does not close a previously imported AISE row. Unknown future deadline formats are rejected for review.
- Source requests retain 20-second timeouts, 2 MiB bounds, a descriptive collector user agent and at least 1.5-second spacing by default. Only source-owned public listing/detail/robots routes are allowed. Account, CV, application-submission and alert endpoints are not visited by collectors.
- Robots rules are checked before listing/detail requests. Challenges, 403/429, malformed layouts and unsafe redirects stop collection; there is no proxy rotation, browser impersonation, login, CAPTCHA solving or security bypass.
- Pagination totals, repeated IDs and source limits are checked. No closure is inferred from an incomplete, capped, failed or empty collection. Expired explicit deadlines are refreshed through the existing import path so old future deadlines do not remain active.
- Deployment alone does not start traffic to any new source. No cron/queue schedule was installed. The existing Glorri adapter and hourly schedule remain unchanged.

## Operation

From `apps/api`, previews require no service token:

```sh
npm run script:import-public-jobs -- --source socar --max-pages 10 --max-jobs 150 --delay-ms 1500
npm run script:import-public-jobs -- --source azercell --max-pages 5 --max-jobs 50 --delay-ms 1500
npm run script:import-public-jobs -- --source pwc --max-pages 1 --max-jobs 50 --delay-ms 1500
npm run script:import-public-jobs -- --source halliburton --max-pages 5 --max-jobs 50 --delay-ms 1500
npm run script:import-public-jobs -- --source ey --max-pages 5 --max-jobs 50 --delay-ms 1500
npm run script:audit-employer-sources
```

Only the explicit `--apply` flag writes, through the already-protected loopback `/internal/jobs/ingest` API. Credentials come from the existing process environment and must not be pasted into commands, documentation or logs. That mode has not been used against these live sources. See `docs/azerbaijan-vacancy-sources.md` for the transport, locking and ingest boundary.

The source audit is read-only, has four workers maximum, 12-second request timeouts, 1 MiB response limits and up to three reviewed same-host redirects. It reports candidate career links for human review, rather than visiting all discovered links or enabling adapters automatically. HTTP 200 is not proof of an official employer identity, a valid vacancy parser or complete coverage. Missing robots (404/410) is distinguished from explicit disallow and from unknown rules; none is a republishing agreement.

## 100-target audit

Completed at **2026-10-01T18:54:21.235Z (22:54 Baku)**, before the final PwC/Halliburton adapter additions:

- 57 `public-page-reachable`.
- 29 `access-needs-review` (including unreadable/unrecognized robot responses, redirects and restrictions).
- 8 `request-failed`.
- 5 `http-unavailable`.
- 1 `response-too-large`.

These are candidate entry-page observations, not vacancy totals or legal permission findings. A failure from this machine is not proof that every integration with that employer is prohibited. The strict robots parser rejects unsupported directives for review rather than ignoring them; some such cases may be resolvable without a partnership.

The table lists each target, its candidate/source URL, that audit outcome and its adapter at this checkpoint. An adapter label does not mean production integration. A dash means no reviewed collector yet.

| # | Employer | Sector | Candidate/source URL | Audit outcome | Adapter |
| --- | --- | --- | --- | --- | --- |
| 1 | SOCAR | energy-industry | [careers](https://jobs.socar.az/search/) | `public-page-reachable` | sap-careers |
| 2 | SOCAR Polymer | energy-industry | [candidate website](https://socarpolymer.az) | `public-page-reachable` | — |
| 3 | SOCAR AQS | energy-industry | [candidate website](https://socar-aqs.com) | `public-page-reachable` | — |
| 4 | SOCAR Downstream | energy-industry | [candidate website](https://www.socar.az) | `public-page-reachable` | — |
| 5 | BP Azerbaijan | energy-industry | [candidate website](https://www.bp.com/en_az/azerbaijan/home.html) | `access-needs-review` | — |
| 6 | TotalEnergies | energy-industry | [candidate website](https://totalenergies.com) | `public-page-reachable` | — |
| 7 | SLB | energy-industry | [candidate website](https://www.slb.com) | `public-page-reachable` | — |
| 8 | Halliburton | energy-industry | [careers](https://jobs.halliburton.com/search/?q=&locationsearch=Azerbaijan) | `public-page-reachable` | sap-careers |
| 9 | Baker Hughes | energy-industry | [candidate website](https://www.bakerhughes.com) | `public-page-reachable` | — |
| 10 | Weatherford | energy-industry | [candidate website](https://www.weatherford.com) | `public-page-reachable` | — |
| 11 | Saipem | energy-industry | [candidate website](https://www.saipem.com) | `access-needs-review` | — |
| 12 | Nobel Energy | energy-industry | [candidate website](https://www.nobelenergy.com) | `public-page-reachable` | — |
| 13 | Azfen | energy-industry | [candidate website](https://www.azfen.com) | `public-page-reachable` | — |
| 14 | Technip Energies | energy-industry | [candidate website](https://www.ten.com) | `access-needs-review` | — |
| 15 | AzerGold | energy-industry | [candidate website](https://azergold.az) | `public-page-reachable` | — |
| 16 | Azeraluminium | energy-industry | [candidate website](https://azeraluminium.com) | `request-failed` | — |
| 17 | Holcim Azerbaijan | energy-industry | [candidate website](https://www.holcim.az) | `public-page-reachable` | — |
| 18 | Norm | energy-industry | [candidate website](https://www.norm.az) | `request-failed` | — |
| 19 | STP | energy-industry | [candidate website](https://stp.az) | `public-page-reachable` | — |
| 20 | Baku Steel Company | energy-industry | [candidate website](https://www.bakusteel.com) | `public-page-reachable` | — |
| 21 | PASHA Holding | finance-insurance | [careers](https://pasha-holding.az/az/career/) | `public-page-reachable` | — |
| 22 | PASHA Bank | finance-insurance | [careers](https://www.pashabank.az/careers/lang,az/) | `http-unavailable` | — |
| 23 | PASHA Insurance | finance-insurance | [careers](https://www.pasha-insurance.az/career/) | `access-needs-review` | — |
| 24 | PASHA Life | finance-insurance | [careers](https://www.pasha-life.az/about?lang=az#career) | `public-page-reachable` | — |
| 25 | Kapital Bank / Bir | finance-insurance | [careers](https://careers.bir.az/vacancies) | `access-needs-review` | — |
| 26 | ABB | finance-insurance | [careers](https://careers.abb-bank.az/vakansiyalar) | `public-page-reachable` | abb |
| 27 | Xalq Bank | finance-insurance | [candidate website](https://www.xalqbank.az) | `public-page-reachable` | — |
| 28 | Bank of Baku | finance-insurance | [candidate website](https://www.bankofbaku.com) | `public-page-reachable` | — |
| 29 | Bank Respublika | finance-insurance | [candidate website](https://www.bankrespublika.az) | `public-page-reachable` | — |
| 30 | Unibank | finance-insurance | [candidate website](https://unibank.az) | `public-page-reachable` | — |
| 31 | AccessBank | finance-insurance | [candidate website](https://www.accessbank.az) | `access-needs-review` | — |
| 32 | Yelo Bank | finance-insurance | [candidate website](https://www.yelo.az) | `public-page-reachable` | — |
| 33 | Rabitabank | finance-insurance | [candidate website](https://www.rabitabank.com) | `access-needs-review` | — |
| 34 | TuranBank | finance-insurance | [candidate website](https://www.turanbank.az) | `request-failed` | — |
| 35 | Expressbank | finance-insurance | [candidate website](https://www.expressbank.az) | `public-page-reachable` | — |
| 36 | Azer Turk Bank | finance-insurance | [candidate website](https://atb.az) | `access-needs-review` | — |
| 37 | Bank Avrasiya | finance-insurance | [candidate website](https://www.bankavrasiya.az) | `public-page-reachable` | — |
| 38 | AFB Bank | finance-insurance | [candidate website](https://www.afb.az) | `public-page-reachable` | — |
| 39 | Premium Bank | finance-insurance | [candidate website](https://www.premiumbank.az) | `public-page-reachable` | — |
| 40 | ASB Bank | finance-insurance | [candidate website](https://www.asb.az) | `access-needs-review` | — |
| 41 | AtaSigorta | finance-insurance | [candidate website](https://www.atasigorta.az) | `request-failed` | — |
| 42 | Ateshgah Insurance | finance-insurance | [candidate website](https://ateshgah.com) | `public-page-reachable` | — |
| 43 | Azercell | telecom-technology | [careers](https://careers.digitalecosystem.az/Azercell/search/) | `public-page-reachable` | sap-careers |
| 44 | Bakcell | telecom-technology | [candidate website](https://www.bakcell.com) | `public-page-reachable` | — |
| 45 | Nar / Azerfon | telecom-technology | [candidate website](https://www.nar.az) | `public-page-reachable` | — |
| 46 | Azerconnect | telecom-technology | [candidate website](https://www.azerconnect.az) | `public-page-reachable` | — |
| 47 | AzInTelecom | telecom-technology | [candidate website](https://azintelecom.az) | `public-page-reachable` | — |
| 48 | Aztelekom | telecom-technology | [candidate website](https://www.aztelekom.az) | `request-failed` | — |
| 49 | Delta Telecom | telecom-technology | [candidate website](https://delta-telecom.net) | `public-page-reachable` | — |
| 50 | Enginet / CityNet | telecom-technology | [candidate website](https://www.citynet.az) | `public-page-reachable` | — |
| 51 | PashaPay | telecom-technology | [candidate website](https://pashapay.az) | `public-page-reachable` | — |
| 52 | Azericard | telecom-technology | [candidate website](https://www.azericard.com) | `access-needs-review` | — |
| 53 | GoldenPay | telecom-technology | [candidate website](https://goldenpay.az) | `public-page-reachable` | — |
| 54 | SINAM | telecom-technology | [candidate website](https://sinam.net) | `public-page-reachable` | — |
| 55 | Deloitte | professional-services | [careers](https://www.deloitte.com/az/en/careers.html) | `public-page-reachable` | — |
| 56 | EY | professional-services | [careers](https://careers.ey.com/ey/search/?q=&locationsearch=Baku) | `public-page-reachable` | sap-careers |
| 57 | PwC | professional-services | [careers](https://jobs-cee.pwc.com/ea/en/search-results-azerbaijan) | `public-page-reachable` | pwc |
| 58 | KPMG | professional-services | [careers](https://kpmg.com/az/en/careers/our-vacancies.html) | `access-needs-review` | — |
| 59 | McKinsey | professional-services | [careers](https://www.mckinsey.com/careers/search-jobs) | `request-failed` | — |
| 60 | BCG | professional-services | [careers](https://careers.bcg.com/global/en/locations/azerbaijan) | `public-page-reachable` | — |
| 61 | Bain | professional-services | [careers](https://www.bain.com/careers/) | `public-page-reachable` | — |
| 62 | Grant Thornton | professional-services | [candidate website](https://www.grantthornton.az) | `public-page-reachable` | — |
| 63 | BDO | professional-services | [candidate website](https://www.bdo.az) | `public-page-reachable` | — |
| 64 | AZAL | aviation-logistics | [candidate website](https://www.azal.az) | `access-needs-review` | — |
| 65 | ASG Aviation | aviation-logistics | [candidate website](https://asg.az) | `access-needs-review` | — |
| 66 | Azerbaijan Railways / ADY | aviation-logistics | [candidate website](https://ady.az) | `access-needs-review` | — |
| 67 | ASCO | aviation-logistics | [candidate website](https://www.asco.az) | `access-needs-review` | — |
| 68 | Port of Baku | aviation-logistics | [candidate website](https://portofbaku.com) | `public-page-reachable` | — |
| 69 | Silk Way Airlines | aviation-logistics | [candidate website](https://www.silkwayairlines.com) | `public-page-reachable` | — |
| 70 | Silk Way West Airlines | aviation-logistics | [candidate website](https://www.silkwaywest.com) | `public-page-reachable` | — |
| 71 | Bravo | retail-consumer | [candidate website](https://bravosupermarket.az) | `public-page-reachable` | — |
| 72 | Araz Supermarket | retail-consumer | [candidate website](https://arazmarket.az) | `access-needs-review` | — |
| 73 | OBA Market | retail-consumer | [candidate website](https://www.obamarket.az) | `access-needs-review` | — |
| 74 | Bazarstore | retail-consumer | [candidate website](https://bazarstore.az) | `access-needs-review` | — |
| 75 | Kontakt | retail-consumer | [candidate website](https://kontakt.az) | `http-unavailable` | — |
| 76 | Baku Electronics | retail-consumer | [candidate website](https://www.bakuelectronics.az) | `access-needs-review` | — |
| 77 | Irshad | retail-consumer | [candidate website](https://irshad.az) | `access-needs-review` | — |
| 78 | Soliton | retail-consumer | [candidate website](https://soliton.az) | `access-needs-review` | — |
| 79 | Veyseloglu | retail-consumer | [candidate website](https://www.veyseloglu.az) | `public-page-reachable` | — |
| 80 | Azersun | retail-consumer | [candidate website](https://www.azersun.com) | `access-needs-review` | — |
| 81 | Coca-Cola CCI | retail-consumer | [candidate website](https://www.cci.com.tr) | `public-page-reachable` | — |
| 82 | Carlsberg Azerbaijan | retail-consumer | [candidate website](https://carlsbergazerbaijan.az) | `access-needs-review` | — |
| 83 | A+Co | retail-consumer | [candidate website](https://aplusco.az) | `public-page-reachable` | — |
| 84 | Nestle | retail-consumer | [candidate website](https://www.nestle.com) | `access-needs-review` | — |
| 85 | Procter & Gamble | retail-consumer | [candidate website](https://www.pgcareers.com) | `public-page-reachable` | — |
| 86 | JTI | retail-consumer | [candidate website](https://www.jti.com) | `http-unavailable` | — |
| 87 | British American Tobacco | retail-consumer | [candidate website](https://www.bat.com) | `public-page-reachable` | — |
| 88 | PMD Group | construction-agriculture-hospitality | [candidate website](https://pmdgroup.az) | `access-needs-review` | — |
| 89 | PASHA Construction | construction-agriculture-hospitality | [careers](https://www.pashaconstruction.com/az/careers/) | `access-needs-review` | — |
| 90 | PASHA Real Estate | construction-agriculture-hospitality | [candidate website](https://pasharealestate.az) | `access-needs-review` | — |
| 91 | Gilan Holding | construction-agriculture-hospitality | [candidate website](https://www.gilanholding.com) | `request-failed` | — |
| 92 | AG Group | construction-agriculture-hospitality | [candidate website](https://aggroup.az) | `request-failed` | — |
| 93 | Cahan Holding | construction-agriculture-hospitality | [candidate website](https://cahan.az) | `public-page-reachable` | — |
| 94 | Agro Dairy | construction-agriculture-hospitality | [candidate website](https://www.agrodairy.az) | `public-page-reachable` | — |
| 95 | Grand Agro | construction-agriculture-hospitality | [candidate website](https://grandagro.az) | `public-page-reachable` | — |
| 96 | Four Seasons Baku | construction-agriculture-hospitality | [candidate website](https://www.fourseasons.com/baku/) | `access-needs-review` | — |
| 97 | Fairmont Baku | construction-agriculture-hospitality | [candidate website](https://www.fairmont.com/baku/) | `response-too-large` | — |
| 98 | Hilton Baku | construction-agriculture-hospitality | [candidate website](https://www.hilton.com/en/hotels/gydhbhi-hilton-baku/) | `http-unavailable` | — |
| 99 | Marriott Baku | construction-agriculture-hospitality | [candidate website](https://www.marriott.com) | `http-unavailable` | — |
| 100 | PASHA Capital | finance-insurance | [careers](https://www.pashacapital.az/investment/az/about/career/) | `access-needs-review` | — |

## Named employers requiring further work

- **PASHA Holding:** its official career page currently links an Audit Manager vacancy to [Workable](https://apply.workable.com/pasha-holding/j/BDD973568D/). The Holding page and group links are verified, but a complete Workable job metadata contract and crawler-rule interpretation need review before ingestion. PASHA Bank, Insurance, Life, Construction and Capital are separate sources. Do not count a Holding vacancy as coverage of all subsidiaries.
- **Deloitte:** official career page is reachable; it currently renders a global career experience. Azerbaijan-specific vacancy collection is unverified.
- **KPMG:** the direct source access/rules need review. No zero-job result or working adapter is claimed.
- **McKinsey:** the public job-search source request failed here. No bypass or cached-search-result import was added.
- **BCG:** [official Azerbaijan page](https://careers.bcg.com/global/en/locations/azerbaijan) is verified; public search is a separate contract requiring a reviewed country filter and complete detail/pagination handling.
- **Bain:** the global careers page is reachable, but an Azerbaijan job inventory/local office is not established. Import only jobs that actually identify Azerbaijan; do not fabricate local listings.
- **Bir careers/PashaPay:** public links are discovered, but the actual listing contract needs review. BirJob's separate bulk-republication terms still need an agreement; no competitor catalogue is copied.

## Verification and remaining release gates

- 146 focused tests passed across seven suites: SAP/PwC parsing and limits, geography/tenant/identity guards, safe 100-target discovery, CLI selection, ABB/Hellojob transport, HTTP ingest acknowledgements and existing jobs ingestion units.
- API TypeScript typecheck and compilation passed. The compiled registry loads all 100 entries, and the compiled preview CLI fetched all three PwC jobs without a service token.
- The real database ingestion regression is **blocked in this environment** because the existing local Docker/Postgres stack is stopped. Docker was not restarted and no unrelated volumes/projects were touched. Retain PR #13's earlier integration evidence with its documented limitation; there is no new exact-head database pass.
- Public catalogue/category UI is in separate draft PR #14; it is not part of this branch and is not live. It keeps browsing all eligible jobs separate from personalized matches.

Remaining work: review source arrangements/attribution; finish the 94 missing employer adapters and each source's pagination/closure contract; resolve the Azercell exception; restore the authorized local test environment and run exact-head ingestion/database tests; rehearse small reviewed imports and source freshness; integrate the catalogue/category branch; satisfy release PR #12's operational gates before deployment. New source schedules, Telegram notifications and external auto-apply are not enabled by this work. Do not advertise “all Azerbaijan vacancies” or “100 companies integrated” from this checkpoint.

*Update, 4 October 2026:* the register is the 100 originally requested employers plus declared, verified additions (currently Xsolla, collected from its own Lever board): 101 targets. See `source-expansion-handoff-2026-10-02.md` and `audit-employer-sources.spec.ts` for the invariants that protect the original coverage.
