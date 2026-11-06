# HRX.az Upstream Source Map — Final Research Pass

Research date: 2026-10-04  
Purpose: Identify public upstream vacancy sources represented in HRX.az so AISE can prioritize original-source integrations.  
*Important: This is a best-effort public-source inventory, not a mathematical guarantee of every HRX ingestion source. HRX hides many outbound URLs behind redirects, some pages are not search-indexed, and the platform mixes direct employer submissions with imported vacancies. Only use the confidence labels below.*

---

## 1. Current HRX Scale
At the time of the final pass, HRX publicly reported approximately:
- **4,364 active vacancies**
- **1,801 employers**
- **1,028 new vacancies** in the previous 7 days  
*Source:* `https://hrx.az/is-elanlari`

This scale means employer-by-employer manual enumeration is not enough by itself. The correct approach is to identify recurring upstream domains and ATS families, then inspect the long tail of direct employer sources.

---

## 2. Confidence Model
Use these labels:
- `CONFIRMED_OUTBOUND` — an HRX vacancy page explicitly displays the external domain used for application.
- `CONFIRMED_PLATFORM_IMPORT` — HRX clearly represents another vacancy platform/source as the vacancy owner/source or preserves unmistakable platform-specific application data.
- `STRONG_UPSTREAM_MATCH` — HRX hides the destination hostname, but the same vacancy/title/text is found on the employer's official current ATS/career system.
- `DISCOVERY_LEAD` — plausible source that requires re-verification before production implementation.
- `NOT_PROVEN` — do not claim HRX scrapes it directly.

---

## 3. Directly Confirmed HRX Outbound Domains
These are the strongest findings because HRX itself exposes the hostname on vacancy pages.

| # | Domain / Source | Confidence | Type | Example / Evidence |
|---|---|---|---|---|
| 1 | `jobs.glorri.az` | CONFIRMED_OUTBOUND | ATS / vacancy platform | HRX AZAL / Kontakt Home / Expressbank / IRIA / Mətanət A vacancies |
| 2 | `smartjob.az` | CONFIRMED_OUTBOUND | Local job board | HRX Dövlət Neft Fondu vacancy |
| 3 | `busy.az` | CONFIRMED_OUTBOUND | Local job board | HRX Facility Management Group, EAST TRADE vacancies |
| 4 | `hrin.az` | CONFIRMED_OUTBOUND | Local job board | HRX Retail Group Azerbaijan vacancy |
| 5 | `hellojob.az` | CONFIRMED_OUTBOUND | Local job board | HRX Express Bank and Bank of Baku vacancies |
| 6 | `iseqebul.az` | CONFIRMED_OUTBOUND | Local job board | HRX Kirpi Tekstil designer vacancy |
| 7 | `easyjob.az` | CONFIRMED_OUTBOUND | Local job board | HRX Azdizayn Group vacancy |
| 8 | `classic.jobsearch.az` | CONFIRMED_OUTBOUND | Local job board | HRX MOTUZ / anonymous employer vacancy |
| 9 | `az.linkedin.com` | CONFIRMED_OUTBOUND | Job/social platform | HRX Bir, ABB, PD&MS, InvestAZ and other vacancies |
| 10 | `careers.bir.az` | CONFIRMED_OUTBOUND | Group careers / ATS | HRX Bir backend developer; also relevant to Birbank/m10/Birmarket ecosystem |
| 11 | `job.metak.az` | CONFIRMED_OUTBOUND | Employer ATS | HRX Metak vacancies |
| 12 | `career.pasha-insurance.az` | CONFIRMED_OUTBOUND | Employer careers | HRX PASHA Insurance / PASHA Sığorta vacancies |
| 13 | `careers.sinteks.com` | CONFIRMED_OUTBOUND | Employer careers | HRX Sinteks vacancies |
| 14 | `airswift.com` | CONFIRMED_OUTBOUND | Recruiter / job source | HRX Airswift vacancies |
| 15 | `career2.successfactors.eu` | CONFIRMED_OUTBOUND | SAP SuccessFactors ATS | HRX Deloitte vacancy |
| 16 | `sabahhub.com` | CONFIRMED_OUTBOUND | Employer careers | HRX SABAH.HUB senior strategy vacancy |
| 17 | `e-health.gov.az` | CONFIRMED_OUTBOUND | Government/public careers | HRX e-Səhiyyə IT project manager vacancy |
| 18 | `yelo.az` | CONFIRMED_OUTBOUND | Employer careers | HRX Yelo Bank vacancy |
| 19 | `hr.azericard.com` | CONFIRMED_OUTBOUND | Employer HR portal | HRX Azericard vacancy |
| 20 | `carlsbergazerbaijan.az` | CONFIRMED_OUTBOUND | Employer careers | HRX Carlsberg Azerbaijan vacancy |
| 21 | `careers.bankofbaku.com` | CONFIRMED_OUTBOUND | Employer careers | HRX Bank of Baku audit vacancy |
| 22 | `pasha-life.az` | CONFIRMED_OUTBOUND | Employer careers | HRX PASHA Life vacancy |
| 23 | `ddla.gov.az` | CONFIRMED_OUTBOUND | Government careers | HRX Dövlət Dəniz və Liman Agentliyi vacancy |
| 24 | `careers.ram.az` | CONFIRMED_OUTBOUND / embedded original link | Group careers | HRX Ram Holding, Prior BOKT, Prior Leasing, Imotors, Grand Motors |
| 25 | `karyera.veyseloglu.az` | CONFIRMED_OUTBOUND / embedded original link | Group careers | HRX Veysəloğlu vacancies |

---

## 4. High-Value Platform-Import Evidence
These are strong source candidates even when the HRX page does not expose the hostname in the application widget.

### 4.1 jobU
- **Status:** `CONFIRMED_PLATFORM_IMPORT`
- **Detail:** HRX contains vacancies where the source/employer record is literally jobU, and imported vacancy text preserves addresses such as `xalqbank@jobu.az`. Examples include Xalq Bank and other banking-sector vacancies.
- **AISE Implication:**
  - Investigate `jobu.az` as a standalone source.
  - Measure overlap with bank first-party career pages.
  - Do not assume every jobU record is unique.
- **Example:** `https://hrx.az/is-elanlari/informasiya-texnologiyalari/melumat-bazasi-inzibatcisi/melumat-bazasinin-idare-edilmesi-uzre-mutexessis-jobu-eac3e9`

### 4.2 Aviation JobSearch
- **Status:** `CONFIRMED_PLATFORM_IMPORT`
- **Detail:** HRX maintains a source/company entity named Aviation JobSearch Europa and identifies its site as `aviationjobsearch.com`. HRX showed multiple active aviation jobs from this source.
- **Example:** `https://hrx.az/sirketler/aviation-jobsearch-europa`
- **AISE Implication:**
  - Good niche source for aviation roles.
  - Filter strictly for Azerbaijan/Baku relevance.

### 4.3 JobPark
- **Status:** `CONFIRMED_PLATFORM_ENTITY, DOMAIN REQUIRES DISCOVERY`
- **Detail:** HRX maintains a source/company entity named JobPark and describes it as a job platform.
- **Example:** `https://hrx.az/sirketler/jobpark`
- **AISE Implication:** Do not invent the canonical domain. Resolve it before adapter work.

---

## 5. Strong Upstream ATS Matches Where HRX Hides the Hostname
These should be treated differently from `CONFIRMED_OUTBOUND`.  
The HRX vacancy exists and the same current vacancy is found on an official ATS/career site, but HRX's indexed page does not expose the external hostname.

### 5.1 Xsolla → Lever
- **Status:** `STRONG_UPSTREAM_MATCH`
- **Detail:** HRX carries a large number of Xsolla Baku roles, including:
  - Backend Developer
  - Front-End Developer
  - Backend Engineer (Go)
  - Platform Engineer
  - Senior Network/Infrastructure Engineer
  - Site Reliability Engineer
  - Security Engineer
  - Technical Lead
- **Official Upstream:** `jobs.lever.co/xsolla`
- **Official Listing Index:** `https://jobs.lever.co/xsolla`
- **AISE Implication:** A reusable Lever adapter could cover Xsolla and potentially other employers, but verify Azerbaijan-relevant tenants before broadening.

### 5.2 Worley → Worley Careers
- **Status:** `STRONG_UPSTREAM_MATCH`
- **Detail:** HRX carries current Worley Azerbaijan vacancies with text matching official Worley vacancies.
- **Official Upstream:** `jobs.worley.com`
- **Example Official Job:** `https://jobs.worley.com/careers/job/1133915040033`
- **HRX Example:** `https://hrx.az/is-elanlari/logistika-ve-satinalma/keyfiyyet-meneceri/keyfiyyete-nezaret-uzre-menecer-worley-e509db`
- **AISE Implication:** Historical/underlying Worley recruitment infrastructure may also expose Oracle/Taleo-style routes. Treat the canonical current Worley careers system as the preferred integration target.

### 5.3 SLB → SLB Careers
- **Status:** `STRONG_UPSTREAM_MATCH`
- **Detail:** HRX carries SLB roles whose text matches SLB's official careers system.
- **Official Upstream:** `careers.slb.com`
- **Example:** `https://careers.slb.com/jobdescription.aspx?id=87213`
- **HRX Examples:** IT Onsite Specialist, Sales Admin, Tax Manager and other Baku roles.
- **AISE Implication:** Prefer SLB's first-party careers system over secondary copies.

### 5.4 QuantumBlack / McKinsey → McKinsey Careers
- **Status:** `STRONG_UPSTREAM_MATCH`
- **Detail:** HRX carries:
  - Data Scientist II — QuantumBlack, AI by McKinsey
  - Business Analyst — McKinsey & Company
- **Official:** `https://www.mckinsey.com/careers/search-jobs/jobs/datascientistii-quantumblackaibymckinsey-110395`
- **AISE Implication:** Treat McKinsey Careers as first-party source; avoid scraping secondary reposts when possible.

### 5.5 Wolt → Greenhouse / Wolt Careers
- **Status:** `STRONG ATS-FAMILY MATCH`
- **Detail:** HRX carries Wolt Baku vacancies. Wolt's public jobs are currently represented through:
  - `careers.wolt.com`
  - `job-boards.greenhouse.io/wolt`
  Greenhouse board contains Baku roles and Wolt Careers is the public first-party front end.
- **AISE Implication:** Investigate Wolt's Greenhouse board as a structured source. Do not claim HRX directly scraped Greenhouse unless vacancy-level routing is confirmed.

---

## 6. HRX Acquisition Modes Inferred from Evidence
HRX appears to combine several acquisition modes:
- **A. Local job-board imports:** Smartjob, Busy, HRIN, HelloJob, iseqebul, EasyJob, JobSearch, jobU.
- **B. Shared ATS / group-career imports:** Glorri, SAP SuccessFactors, Bir careers, RAM careers.
- **C. Direct employer careers:** PASHA Insurance, Sinteks, Yelo Bank, Azericard, Bank of Baku, PASHA Life, Veysəloğlu, Carlsberg Azerbaijan, SABAH.HUB.
- **D. Government/public portals:** e-Health, Dövlət Dəniz və Liman Agentliyi.
- **E. Global recruiters / specialist platforms:** Airswift, Aviation JobSearch.
- **F. Global ATS / corporate recruitment systems:** Lever / Xsolla, Worley Careers, SLB Careers, McKinsey Careers, Greenhouse / Wolt.
- **G. LinkedIn routing:** HRX sometimes routes applications to LinkedIn. (Important: `az.linkedin.com` being the outbound apply URL does not prove LinkedIn was always HRX's original discovery source).

---

## 7. Important Non-Findings
During the sweep, the following common Azerbaijan sources were searched for as explicit HRX outbound domains but were **not** confirmed in the final public-index pass:
- `Boss.az`, `Tap.az`, `JobNet.az`, `JobSite.az`, `isbu.az`, `Position.az`, `Banker.az`, `FED.az`, `Tecrube.az`, `Staffy`, `Jooble`, `jobing.az`, `azjob.az`, `1is.az`, `hh1.az`.

*Note: This does not prove HRX never uses them. It only means: Do not put them in the "confirmed HRX upstream" list without vacancy-level evidence. They remain independent AISE source candidates because BirJob and/or the Azerbaijani market show they contain vacancies.*

---

## 8. Sources That Looked Like Employers But Must Not Be Misclassified
HRX's company directory contains ordinary employers, recruiters, aggregators and job platforms in one catalog.
Therefore:
- A company existing in HRX is not evidence HRX scraped that company's website;
- An HRX-generated company description saying "job platform" is not enough;
- A website listed on the company profile is not automatically a scraper source;
- A vacancy with HRX Easy Apply may have been posted directly by the employer.
*Always require vacancy-level or original-source evidence.*

---

## 9. Direct Employer / HRX-Native Vacancies
HRX also has many vacancies where the application is handled:
- Directly inside HRX,
- Via an email sent through HRX,
- Through a phone number,
- Through "Birbaşa işəgötürənə",
- Without an exposed external source domain.

These are not necessarily scraped from another job site. AISE should not attempt to reproduce HRX coverage only by duplicating its known external sources. A portion of HRX's inventory may be employer-submitted or sourced through channels that do not expose a reusable public upstream.

---

## 10. Highest-Leverage AISE Targets from the HRX Research

### Tier 1 — Build / Research First
1. **Glorri:** Many employers share the same infrastructure; confirmed across banks, government-linked entities, airlines, retail and industrial employers (AZAL, Kontakt Home, Expressbank, IRIA, Mətanət A, VIP Xidmətlər Qrupu). Reusable adapter potential is high.
2. **JobSearch:** Confirmed HRX outbound `classic.jobsearch.az`. (Already an AISE P0 source).
3. **Smartjob:** Confirmed.
4. **HelloJob:** Confirmed.
5. **Busy:** Confirmed.
6. **HRIN:** Confirmed.
7. **jobU:** Confirmed platform-import evidence.
8. **Bir Careers:** One source can cover multiple companies in the Bir ecosystem.
9. **RAM Careers:** One source can cover Ram Holding, Prior BOKT, Prior Leasing, Imotors, Grand Motors.
10. **Lever:** Start with Xsolla (large Baku engineering inventory).

### Tier 2 — Direct Sources
- PASHA Insurance, PASHA Life, Bank of Baku, Yelo Bank, Azericard, Sinteks, Metak, Veysəloğlu, SABAH.HUB, Carlsberg Azerbaijan, Airswift, Worley, SLB, McKinsey / QuantumBlack, Wolt.

---

## 11. Reusable ATS Families Discovered
| ATS / Family | Example Employer(s) | Status |
|---|---|---|
| **Glorri** | AZAL, Expressbank, Kontakt Home, IRIA, Mətanət A, others | confirmed |
| **SAP SuccessFactors** | Deloitte | confirmed outbound |
| **Lever** | Xsolla | strong upstream match |
| **Greenhouse** | Wolt | strong ATS-family match |
| **Employer/group custom careers** | Bir, RAM, Veysəloğlu | confirmed |
| **Employer custom portals** | PASHA Insurance, Sinteks, Metak, Azericard | confirmed |

*Before creating a generic adapter:*
- Verify stable public structure,
- Preserve tenant/company identity,
- Preserve source requisition ID,
- Preserve original apply URL,
- Test closure semantics per tenant.

---

## 12. Recommended AISE Source Registry Additions
Map into the repository's existing source model (`JobSource`):
- `glorri`
- `smartjob`
- `busy`
- `hrin`
- `hellojob`
- `iseqebul`
- `easyjob`
- `jobsearch`
- `jobu`
- `linkedin_jobs`
- `bir_careers`
- `metak_careers`
- `pasha_insurance_careers`
- `sinteks_careers`
- `airswift`
- `sap_successfactors`
- `sabahhub_careers`
- `ehealth_gov`
- `yelo_careers`
- `azericard_hr`
- `carlsberg_azerbaijan`
- `bankofbaku_careers`
- `pasha_life`
- `ddla`
- `ram_careers`
- `veyseloglu_careers`
- `aviation_jobsearch`
- `lever_xsolla`
- `worley_careers`
- `slb_careers`
- `mckinsey_careers`
- `wolt_greenhouse`

*Rule:* Direct HRX evidence and strong-match evidence have different confidence levels; do not label the whole list "HRX scraper sources" without storing confidence.

---

## 13. Source Reconnaissance Record Format
For each candidate source prior to implementation:

```markdown
## Source

Name:
Canonical domain:
Confidence from HRX research:
Evidence URL:
Source type:
Listing entrypoint:
Public API / embedded JSON:
Rendering model:
Pagination:
Stable vacancy ID:
Canonical vacancy URL:
Apply URL:
Email:
Phone:
Published date:
Deadline:
Closed-state behavior:
Robots/access constraints:
Estimated active Azerbaijan jobs:
Overlap with existing AISE:
Estimated unique contribution:
Implementation difficulty:
Recommended priority:
```

---

## 14. Final Interpretation
The HRX research suggests that its coverage is not produced by one giant list of ordinary Azerbaijani boards.  
It appears to be built from a hybrid source graph:
1. Local job boards,
2. Shared ATS platforms,
3. Group career systems,
4. Direct employer career pages,
5. Public-sector career portals,
6. Recruiters,
7. International specialist boards,
8. LinkedIn/application redirects,
9. Direct employer/HRX-native submissions.

**For AISE, the highest-leverage strategy is therefore:**  
Build reusable integrations for the shared source systems first, then add high-uniqueness employer and government sources. Do not chase 1,800 employers one by one if 10–15 reusable upstream integrations can cover a large share of the market.

---

## 15. Final Working Set

### Directly Evidenced Domains
1. `jobs.glorri.az`
2. `smartjob.az`
3. `busy.az`
4. `hrin.az`
5. `hellojob.az`
6. `iseqebul.az`
7. `easyjob.az`
8. `classic.jobsearch.az`
9. `az.linkedin.com`
10. `careers.bir.az`
11. `job.metak.az`
12. `career.pasha-insurance.az`
13. `careers.sinteks.com`
14. `airswift.com`
15. `career2.successfactors.eu`
16. `sabahhub.com`
17. `e-health.gov.az`
18. `yelo.az`
19. `hr.azericard.com`
20. `carlsbergazerbaijan.az`
21. `careers.bankofbaku.com`
22. `pasha-life.az`
23. `ddla.gov.az`
24. `careers.ram.az`
25. `karyera.veyseloglu.az`

### Confirmed Platform/Source Identities
26. `jobU` / `jobu.az`
27. `Aviation JobSearch` / `aviationjobsearch.com`
28. `JobPark` — canonical domain still needs resolution

### Strong Official Upstream Matches
29. `Xsolla` → `jobs.lever.co/xsolla`
30. `Worley` → `jobs.worley.com`
31. `SLB` → `careers.slb.com`
32. `McKinsey / QuantumBlack` → `mckinsey.com/careers`
33. `Wolt` → `careers.wolt.com` / `job-boards.greenhouse.io/wolt`
