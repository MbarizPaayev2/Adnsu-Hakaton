# Employer and vacancy coverage: diagnosis, first batch and access review (10 October 2026)

## 1. Why the catalogue looked like "only Xsolla"
Measured on production (read-only SQL and the public pages), separating the layers:

| Layer | Finding |
|---|---|
| Catalogue | 1,270 eligible postings from **125 employers** before this work: Glorri 1,231 (124 employers) and Xsolla 39. Everything else registered had never been collected: the registry held 13 other enabled sources, none scheduled. |
| Company pages | Correct: `/companies` lists the 125 observed employers with stable ids, real open counts, verified logos or monograms, and the source of each posting. Searching `xsolla` shows one employer because Xsolla is the only *named* official source that was scheduled; the Glorri employers are many small ones. |
| Collection sources | One scheduler tick claims one source; only Glorri and Xsolla were scheduled. |
| Browser agent | Supports **Lever employers only** (Xsolla is the only Lever employer in the catalogue), which is why the agent page shows one employer. That is a portal-support limit, not a catalogue limit; the campaign form asks for the Lever employer name and the agent page lists Lever as the only supported portal. |
| Application routes | Every posting links to the employer's own application page; assisted browser application exists for Lever; e-mail application only where the employer **published** an address (none yet: 0 postings with an explicitly published address). |

## 2. Access review (accurate, not optimistic)
| Source | robots.txt | Written terms | Decision |
|---|---|---|---|
| ABB (careers.abb-bank.az) | allows | no reuse terms published on the careers site | scheduled, daily, `ROBOTS_ALLOWED_TERMS_PENDING` |
| SOCAR (jobs.socar.az, SAP) | allows | none published | scheduled, daily, pending |
| Azercell (careers.digitalecosystem.az, SAP) | allows | none published | scheduled, daily, pending |
| PASHA Holding (apply.workable.com/pasha-holding) | allows | Workable public postings feed | scheduled, daily, pending |
| PASHA Insurance (career.pasha-insurance.az, Teamtailor RSS) | allows | the employer's own public feed | scheduled, daily, pending |
| **Halliburton** (jobs.halliburton.com) | allows | **website terms forbid "page scrape", "robot", "spider" or any automatic script** | **RESTRICTED** (migration `20261021100000`); nothing scheduled or run |
| PwC (jobs-cee.pwc.com) | allows | terms link unresolved; one posting | not scheduled (no value, unresolved) |
| EY (careers.ey.com) | allows | not reviewed | 0 Baku postings; not scheduled |
| HelloJob, Work.az, SmartJob, Boss.az, eJob, JobSearch | allow | read 10 Oct: no clause on automated access or reuse, no grant either (HelloJob states it may use all vacancy data for its own marketing) | **not scheduled.** Aggregators of other employers' postings: "not forbidden" is not "permitted". Collectors exist and are tested; nothing runs until a written permission or a reviewed policy exists. |
| Yelo Bank | allows | n/a | no reviewed adapter (the import refuses an unvalidated source) |

`ROBOTS_ALLOWED_TERMS_PENDING` is **not** a grant: it means "public, not disallowed, no terms found; permission not requested". Same basis and same remedy as Xsolla (pause, hide, remove on request). No permission e-mail was sent.

## 3. First batch (scheduler-driven; no manual run was started by the engineer)
Scheduled through the audited admin endpoint at 11:30 UTC, daily, conservative per-run limits (the existing scheduler budgets), health-check allowlist extended, and the health check now counts a never-run source from its scheduling time (no false "never ran" alarm).

| Source | First scheduled run | Listed | New unique | Expired on arrival | Note |
|---|---|---|---|---|---|
| ABB | 11:40 | 50 (page limit) | 50 | 8 | listing incomplete by design: the run is capped at 50; the rest arrives over the next runs; ~48 live expected |
| Azercell | 11:50 | 10 | 10 | 2 | complete |
| PASHA Holding | 12:00 | 5 | 5 | 0 | complete |
| PASHA Insurance | 12:10 | 36 | 35 | 0 | complete (1 skipped) |
| SOCAR | 12:20 | 37 | 3 | 0 | 34 skipped: the address was a postal code with the country code ("4770, AZ"), which the collector treated as an unknown location. **Fixed in this release** (an Azerbaijani postal code with the country code is accepted as country-level "Azerbaijan"; a US ZIP is not); the next daily run after deployment should add ~34 |

### Before / after (production, eligible = active, not hidden, not closed, not a duplicate, deadline not passed)
| | Before | After first batch (12:20 UTC) | Expected after SOCAR fix and ABB completion |
|---|---|---|---|
| Employers with an eligible posting | 125 | 130 | 130 (all five are single-employer sources; "Glorri" employers are unchanged) |
| Eligible postings | 1,270 | **1,363** | about 1,470 |
| Sources scheduled | 2 | 7 | 7 |
| Duplicates linked / expired-shown / failed runs | 0 / 0 / 0 | 0 / 0 / 0 | |
| Postings with an explicitly published application e-mail | 0 | 0 | |

Honest reading: +93 postings and +5 employers is a real but modest gain (7%). It does not approach 5,000 and none of the postings above are foreign, expired or duplicates inflating the count. The large remaining pool is the aggregators in §2, which need permission, and employers on ATSs that AISE has no reviewed adapter for.

## 4. Ranked shortlist for the next batch (verified access = public official page, robots allows)
| Rank | Employer / source | Why | Blocker |
|---|---|---|---|
| 1 | SOCAR regional postings | already scheduled; fix deployed completes it | none |
| 2 | Yelo Bank career page | official, bank | needs a reviewed adapter |
| 3 | Employers on shared ATSs found by `script:discover-ats-tenants` (59 audited employers, 3 with a detectable shared ATS: Halliburton (restricted), PASHA Insurance (done), Technip Energies (Oracle Cloud, no adapter)) | official feeds | adapters per ATS |
| 4 | HelloJob / Work.az / SmartJob / Boss.az | thousands of postings, many employers | permission |

## 5. What the candidate sees
* Company pages show the employer, its real open postings and the source; the application route on each posting is the employer's own page; assisted browser application is offered only where a portal adapter exists (Lever); an e-mail application only where the employer published an address.
* No badges are invented; a logo is shown only when it was verified, otherwise a monogram.
