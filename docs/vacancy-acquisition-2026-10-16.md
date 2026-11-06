# Vacancy acquisition: measurement, coverage/gaps matrix and discovery backlog (16 October 2026)

This is the living record for vacancy acquisition. It separates what is **implemented** (code on a branch), **live** (released and measured in
production) and **unverified** (probed or assumed, not yet measured). It does not claim that every Azerbaijan vacancy is covered: the largest
job boards prohibit automated collection, and many employers publish only on those boards or behind bot protection.

## 1. How it is measured

Every count uses the actionable predicate `actionableJobWhere()` (apps/api/src/jobs/jobs.service.ts): `status = ACTIVE`, not hidden, not linked as a
duplicate, and no elapsed deadline. Employers are counted by `companyKey` (`normalizeCompany`), the same basis as the 1,505 / ~300 baseline.

- Before a release: `scripts/acquisition-baseline.sql` (read-only transaction, psql on the host).
- After a release: `node dist/scripts/report-acquisition-metrics.js --out after.json [--compare before.json]` in the API container. It adds regions
  (explicit place names only, `az-regions.ts`; a location naming no settlement is "unknown", never Bakı), segments (`vacancy-segments.ts`) and the
  window figures (ingested, duplicate-linked, already expired, closed by reason, deadlines passed).

## 2. Measured production results (live)

| Measure (actionable predicate) | Baseline 16 Oct 12:19 UTC (26bba5c) | After release 200a76f, 15:08 UTC | Change |
|---|---:|---:|---:|
| Actionable postings | 1,505 | 1,541 | **+36 net** |
| Distinct employers (companyKey) | 295 | 299 | +4 |
| Email-bearing postings (method EMAIL with a published address) | 14 (11 employers) | 16 | +2 |
| Posted within 7 days | 360 | 392 | +32 |
| Posted within 30 days | 1,320 | 1,350 | +30 |
| Seen by a collector within 48 h | 1,459 | 1,487 | +28 |

Newly imported by the integration release: Veyseloglu 14, AzerGold 7, Avrora 2 (both email-bearing). The rest of the net change is normal churn on
existing sources (Glorri 993 → 1,004). In the 7 days to 15:08: 922 postings ingested, 14 of them linked as duplicates, 721 closed. The HelloJob repair
was released but its effect was not yet visible at 15:08; re-measure after its next scheduled run.

Note on the 300 vs 295 employer figure: the brief's 300 came from employer names; `companyKey` folds spelling variants, so 295 is the comparable
baseline for the script.

Not yet live (this branch, PR pending): İrşad Electronics and Baker Hughes collectors, the metrics script, the region and segment classifiers.
Their effect will be measured with `--compare` after the release thread ships them.

## 3. Sources added or repaired in this round

| Source | Route | Status | Expected yield | Email-bearing |
|---|---|---|---|---|
| Avrora, AzerGold, Veyseloglu | official employer pages | **live** (200a76f) | 2 / 7 / 14 measured | Avrora yes |
| HelloJob repair | public pages, robots-allowed | **live**, effect unmeasured | n/a | some |
| İrşad Electronics | own careers page `irshad.az/az/sirket/vakansiyalar` (robots allows, crawl-delay 30 s honoured) | **implemented**, daily schedule in migration | regional branch roles (store manager, sales) in several towns | no (apply link) |
| Baker Hughes | official Workday site linked from careers.bakerhughes.com; public search JSON, kept only when detail says country = Azerbaijan | **implemented**; parser checked against a real posting response (closing date becomes the deadline) | 4 Baku postings on the second probe (5 on the first) | no |
| Araz Supermarket | own portal jobaraz.retail.az, same platform as Veyseloglu (GET list, no robots file) | **next**: fixtures saved on the probe machine | 1 active vacancy today | yes: "Career@retail.az" published on the posting |
| Bravo | own pages www.bravosupermarket.az/career/all-vacancies/ (robots allows all) | **next**: 21 detail pages saved | 13 head-office roles, 7 store role forms naming Sumqayıt, Xırdalan, Gəncə, Şəmkir, Tovuz, Yevlax, 1 distribution centre | no (web form) |
| Coca-Cola İçecek | careerscci.com | **stopped**: the search page now serves a bot challenge | 2 Baku jobs seen on the first probe | no |

## 4. Coverage/gaps matrix

### 4.1 Regions (economic regions, 2021 division)

Counts are lower bounds taken from the 40 most common location strings at the baseline (the script's region classifier will
replace this after release). Most postings name only Bakı or no settlement.

| Region | Baseline postings naming it | Sources that reach it | Gap / next route |
|---|---:|---|---|
| Bakı | majority | all | well covered |
| Abşeron-Xızı (Sumqayıt, Xırdalan, Masazır) | ~12 | Glorri, SmartJob, retail chains | retail/logistics employers' own pages |
| Qarabağ (Xankəndi, Bərdə, Ağdam, Füzuli…) | ~24 | Glorri, state reconstruction employers | state agencies time out from the probe network |
| Gəncə-Daşkəsən | ~13 | Glorri, SmartJob | İrşad (implemented), Araz/Bravo branches |
| Mərkəzi Aran (Mingəçevir, Yevlax…) | ~5 | Glorri | İrşad, retail chains |
| Mil-Muğan (Beyləqan, Sabirabad…) | ~11 | Glorri, agri employers | agri holdings (backlog) |
| Quba-Xaçmaz | ~7 | Glorri | retail chains, Veyseloglu |
| Şirvan-Salyan (Şirvan, Hacıqabul…) | ~10 | Glorri | retail chains |
| Lənkəran-Astara | low | Glorri | retail chains, tea/agri employers |
| Şəki-Zaqatala | low | Glorri | hospitality (Qəbələ resorts) |
| Qazax-Tovuz | low | Glorri | retail chains |
| Dağlıq Şirvan | low | Glorri | hospitality |
| Şərqi Zəngəzur | very low | state reconstruction | state agencies |
| Naxçıvan | very low | none dedicated | no public route found yet |

### 4.2 Industries, seniority and employment types

| Segment | Current state | Gap / next route |
|---|---|---|
| Banking, insurance, telecom | good (ABB, Kapital, PASHA, Azercell, Yelo, Glorri) | Bank of Baku, Bakcell, Azər Türk Bank blocked by bot protection → outreach draft 2 |
| Oil, gas, energy services | SOCAR, AzerGold; Baker Hughes implemented | bp blocked → outreach draft 2; SLB, Halliburton, Saipem, TechnipFMC, KBR (backlog: global ATS with AZ filter) |
| Retail and FMCG | Veyseloglu, Avrora; İrşad implemented | Araz, Bravo, Bazarstore, OBA, Kontakt (blocked), Baku Electronics (blocked) |
| Hospitality | minimal | hotel groups' global ATS (Marriott, Hilton, Accor) with Baku filter |
| Public sector | minimal | DMA / e-sosial vacancy bank, civil-service competitions (dqdk), DİM, TƏBİB: timeouts from probe network |
| Education, health | minimal | universities' own vacancy pages (ADA live, 1 posting), private clinics |
| International organisations | minimal | ReliefWeb needs an approved appname (founder decision); UNDP disallows crawlers |
| Internships and graduate programmes | from Glorri/SmartJob only | bank and telecom internship pages; seasonal, need dated schedules |
| Trades and blue-collar | from Glorri/SmartJob | retail chains, construction, manufacturing (Azersun blocked) |
| Part-time | rare | retail and hospitality chains |
| Senior/executive | rare | executive search firms rarely publish; global ATS tenants |

### 4.3 Email-bearing vacancies

16 live. A posting is email-bearing only when the employer published the address on that posting. Organisation-wide CV inboxes (AZCON, Xalq Bank,
Holcim) are **not** attached to postings. No HR address is ever guessed. The best next source is Araz Supermarket, whose detail pages publish the
application address.

### 4.4 Freshness

At 15:08: 25% posted within 7 days, 88% within 30 days, 96% seen by a collector within 48 h. 721 closures in 7 days show the closure logic is
active; postings from sources that cannot prove a complete listing are not closed by inference.

## 5. Access decisions (preserved)

Restricted sources stay restricted: Work.az, Boss.az, Busy.az, JobSite.az, BirJob and Glorri's terms are respected as already decided (Glorri is
collected only within the existing decision). Sites that answer with a bot challenge or 403 are not worked around. Unavailable sources get a
partnership or employer-submission route instead: drafts are in `docs/vacancy-source-outreach-drafts-2026-10-16.md` and **none has been sent**.

One probe request to ReliefWeb's API host (a reachability check) was sent before its robots.txt was read; it returned no data and nothing was
stored. Every collector reads robots.txt first.

## 5a. Second probe round (16 October, 33 sources, GET only, robots first)

- Already collected through Glorri (no new route needed): AccessBank (9), Avromed (10), Unibank (48, apply links go to Glorri), Rabitabank,
  Port of Baku (6), Azərpoçt (3). Their postings name Salyan, İsmayıllı, Sabirabad, Xırdalan, Masallı, Qəbələ, Beyləqan, Gəncə, Sədərək,
  Mingəçevir, Şəmkir, Bərdə, Quba and Lənkəran, so regional coverage depends heavily on the Glorri decision.
- Small own pages: Al Market (3, Sumqayıt warehouse), Mediclub (2), Dünya School (1). Low yield; collect only alongside a shared adapter.
- Stale or empty: Azerconnect (2, one past its deadline), Rahat (2 ads from 2019, cv@rahat.az), Soliton (0), Neptun (placeholder text only).
- No usable route: Nar's vacancy API returned HTTP 500 twice; UN Azerbaijan lists 0 rows; SDU's vacancy link is empty.
- Blocked or unreachable, not worked around: Kontakt (403), Optimal (robots 403), Baku Oxford School (challenge), Tufandag and European
  Azerbaijan School (HTTP 447), Shahdag (suspended), Buta Aptek and Yeni Klinika (invalid certificates), five domains without DNS.
- Terms were checked only for sources from the first round; the new discovery sources' terms are not yet checked.

## 5b. Third probe round: reusable job systems (16 October, 39 registry employers, 134 GET requests, 2-hour cap)

Only tenants linked from the employer's own site count. Result: 33 current Azerbaijan postings across 5 employers; no Workday tenants.

| Employer | System | AZ postings now | Structured data the site itself uses | Decision |
|---|---|---:|---|---|
| Fairmont Baku (Accor careers site, Baku filter; applications go to SmartRecruiters) | Accor careers | 19 | no (HTML) | **implemented** (`fairmont-baku`): listing facet 313 walked until the stated total; JobPosting data per job; terms read, no automated-access clause |
| STP | own portal stpcareer.com | 9 (Sumqayıt) | no (HTML) | **implemented** (`stp`): single list with stated count; posting date and deadline from the page; no published terms |
| TotalEnergies | Avature | 3 (Baku) | RSS feed | park: 3 postings; revisit if an Avature collector is needed for others |
| Weatherford | Oracle Recruiting Cloud | 2 (Baku) | Oracle CE REST | park: Oracle collector not worth it for 2 postings; TechnipFMC's Oracle site has 0 AZ of 115 |
| PASHA Life | own site | 1 | no | park (single posting) |
| P&G (Phenom), BAT (SuccessFactors via Radancy) | — | 0 | — | nothing to collect today |
| SLB, PASHA Bank | own search needing POST / list API not found | not measured | — | park; not worth a POST-based bespoke collector now |
| PashaPay | Kapital group HR platform (careers.bir.az) | — | same backend as the existing `kapital` collector | already covered |

Blocked and not worked around: Saipem, Four Seasons, Azericard, ASG (robots 403); Nestlé, Hilton, Marriott (403); JTI (429); PASHA Construction
(525); Gilan Holding (unreachable); Turanbank, Atasığorta (certificate did not verify). No careers link on their own sites: Carlsberg Azerbaijan,
Silk Way Airlines, Silk Way West, AzInTelecom, SOCAR Polymer. Glorri-only (no new route): Bank Respublika, Expressbank, Aztelekom, PASHA Real
Estate, Baku Steel, OBA. TotalEnergies, P&G and BAT counts come from an "Azerbaijan" search; Weatherford and TechnipFMC from full lists filtered by country.

Conclusion for yield per hour: the registry's global employers publish few Azerbaijan postings on their own systems (most go through local boards).
The two remaining builds worth their effort, Accor (19) and STP (9), are implemented in the round-3 PR; everything else is parked above with its reason.
Live gain is measured with the same predicate only after the release thread deploys them.

## 6. Ranked backlog: incremental value per engineering hour

Strategy (Fizuli, 16 Oct 15:55): optimise for fresh, unique, actionable vacancies per engineering hour. Prefer recovering postings in existing
collectors, structured feeds and employer-authorised APIs, and reusable ATS collectors that serve several employers. No bespoke adapter for a single
small employer by default; discovery is time-boxed and low-yield sources are parked with a reason. Yields are today's observed counts, not forecasts;
effort is engineering hours to a tested collector; maintenance is the ongoing cost when the source changes.

| Rank | Candidate | AZ yield now | New employers / regions | Overlap with inventory | Access and reliability | Effort / maintenance | Decision |
|---:|---|---|---|---|---|---|---|
| 1 | HelloJob repair (existing collector, released in 200a76f) | 86 at baseline; recovery not yet measured | many small employers | low (own board) | public, robots-allowed | done / existing | **measure** after its next run with the same predicate |
| 2 (done, 5b) | Batch ATS check of the 76 "needs-verification" registry employers (official career link → Workday, SuccessFactors, Oracle, Workable, Lever, Teamtailor) | unknown; each hit reuses a collector | large employers in energy, FMCG, hospitality | low | official links only | one time-boxed probe (~2 h); each hit is a registry entry, no new code | **next** |
| 3 | Oracle Recruiting Cloud collector (public job-requisition REST used by Oracle career sites) | Azerconnect 2 (one stale); others unknown until rank 2 | reusable across Oracle tenants | low | public JSON, no login | ~1 day / low | build only if rank 2 finds ≥3 Oracle tenants with live AZ postings |
| 4 | More Workday tenants (collector exists) | Baker Hughes 4 (implemented) | per tenant | low | public cxs JSON | registry entry per tenant | add tenants found in rank 2 |
| 5 | Bravo own pages | 21 (13 head-office, 7 standing store application forms, 1 distribution centre) | 1 employer; Sumqayıt, Xırdalan, Gəncə, Şəmkir, Tovuz, Yevlax | low | robots allows all; static HTML | ~3 h bespoke / medium | **parked behind 2–4**; fixtures saved. The 7 store forms are standing calls without dates, so they would need to be labelled as such, not counted as fresh |
| 6 | Job boards (Work.az, Boss.az, Busy.az, JobSite.az, BirJob) | largest volume | very many | medium | terms prohibit collection | partnership feed only | outreach draft ready, **not sent**; founder decision |
| 7 | State Employment Agency / e-sosial vacancy bank, civil-service competitions | potentially largest public-sector and regional source | public sector, all regions | low | timed out from probe network | unknown | re-probe from an Azerbaijani network; open-data export or data-sharing request |
| 8 | ReliefWeb (UN OCHA) | small | international organisations | low | API needs an approved appname | ~2 h | founder decision on registering |

Parked (with reason):

| Source | Reason |
|---|---|
| Araz Supermarket | 1 active vacancy; a bespoke variant for one posting does not pay back, even though it is email-bearing. Revisit if its count grows (same platform as Veyseloglu, so the cost is low then). |
| AccessBank, Avromed, Unibank, Rabitabank, Port of Baku, Azərpoçt | Publish only through Glorri, so they add nothing beyond the existing Glorri decision. |
| Al Market (3), Mediclub (2), Dünya School (1) | Single small employers; low yield. |
| Azerconnect own page, Rahat, Soliton, Neptun | Stale (deadline passed, 2019 ads), empty or placeholder content. |
| Coca-Cola İçecek | Bot challenge since the second probe; covered by outreach draft 2. |
| Nar API, UN Azerbaijan, SDU | API error twice, 0 rows, no vacancy page. |
| Kontakt, Optimal, Baku Oxford School, Tufandag, European Azerbaijan School, Shahdag, Buta Aptek, Yeni Klinika | Blocked, challenged, suspended or invalid certificate; not worked around. |

Effort so far this round: about one working day for İrşad, Baker Hughes, the metrics script and classifiers, two probe rounds and this report.
Measured live gain from the integration release: +36 actionable postings, +4 employers, +2 email-bearing. İrşad and Baker Hughes are not yet live.

## 7. Operational notes for the release thread

- New source keys to add to the host health allowlist: `irshad`, `baker-hughes` (and any later keys from this branch).
- Code rollback must pause the new schedules first (the migration only inserts rows; it never overrides an existing JobSource row).
- After deploy, run `report-acquisition-metrics --compare` against the 15:08 snapshot and record the result in this file.
