# Azerbaijan Vacancy Source Expansion — Handoff Checkpoint

**Date:** 2 October 2026  
**Branch:** `codex/azerbaijan-source-expansion`  
**Base HEAD:** `305c274a419cfa0f29128693e0ddc8b3d2a3174e`  
**Workspace:** `/Users/fizuli.050icloud.com/Projects/aise-source-expansion`

---

## 1. Implemented Original Employer Sources & Working Collectors

In addition to public job boards (`hellojob`, `smartjob`, `boss`, `work`), we expanded coverage to verified **original employer career portals and direct ATS platforms**:

| Source Key | Source Name | Source Type | Public Entry Point | Implementation Files | Openings Verified | Coverage Type |
|---|---|---|---|---|---|---|
| `pasha-holding` | PASHA Holding | Direct ATS (Workable) | `https://apply.workable.com/pasha-holding/jobs.md` | `workable.parser.ts`<br>`workable.collector.ts` | 5 active | Complete (`complete: true`) |
| `yelo` | Yelo Bank | Direct Employer Portal | `https://www.yelo.az/az/about-bank/career/` | `yelo.parser.ts`<br>`yelo.collector.ts` | 10 active | Complete (`complete: true`) |
| `abb` | ABB Careers | Direct Employer Portal | `https://careers.abb-bank.az/api/vacancy/v2/get` | `abb.collector.ts` | 60 active | Bounded preview |
| `socar` | SOCAR Careers | Direct ATS (SAP) | `https://jobs.socar.az/search/` | `sap-careers.collector.ts` | 34 active | Bounded preview |
| `azercell` | Azercell Careers | Direct ATS (SAP) | `https://careers.digitalecosystem.az/Azercell/search/` | `sap-careers.collector.ts` | 16 active | Bounded preview |
| `pwc` | PwC Azerbaijan | Direct Employer | `https://jobs-cee.pwc.com/ea/en/search-results-azerbaijan` | `pwc.collector.ts` | 2 active | Complete (`complete: true`) |
| `halliburton`| Halliburton | Direct ATS (SAP) | `https://jobs.halliburton.com/search/?q=&locationsearch=Azerbaijan`| `sap-careers.collector.ts` | 1 active | Complete (`complete: true`) |
| `ey` | EY Careers | Direct ATS (SAP) | `https://careers.ey.com/ey/search/?q=&locationsearch=Baku` | `sap-careers.collector.ts` | 0 active (Baku) | Complete (`complete: true`) |
| `smartjob` | SmartJob.az | Public Job Board | `https://smartjob.az/vakansiyalar` | `smartjob.parser.ts`, `smartjob.collector.ts` | Over 3,000+ | Historical sitemap |
| `boss` | Boss.az | Public Job Board | `https://boss.az/search/vacancies?sortBy=DATE` | `boss.parser.ts`, `boss.collector.ts` | Over 2,000+ | Public search/categories |
| `work` | Work.az | Public Job Board | `https://www.work.az/vakansiyalar` | `work.parser.ts`, `work.collector.ts` | Over 1,000+ | Public sitemap |
| `hellojob` | Hellojob | Public Job Board | `https://www.hellojob.az/vakansiyalar` | `hellojob.parser.ts`, `public-job-collector.ts` | Over 1,000+ | Public listings |
| `glorri` | Glorri ATS | ATS Platform | `https://glorri.az` | `apps/api/src/scrapers/glorri/` | Variable | Hourly sync |

### Operational Employer Verification & Quarantined Tenants:
- **Verified Working Employer ATS Tenants:**
  - `pasha-holding`: Outbound ATS link confirmed on official site (`https://pasha-holding.az/az/career/vacancies/` -> `https://apply.workable.com/pasha-holding/j/BDD973568D`). 5 live vacancies.
  - `yelo`: Direct employer career portal on `yelo.az` confirmed. 10 live vacancies.
- **Quarantined / Disabled Candidate Tenants (Additive corrective migration `20261011090000_disable_unverified_employer_sources`):**
  - `accessbank`: Candidate Workable tenant was found to belong to Nigerian Access Bank PLC (`accessbankplc.com`), not AccessBank Azerbaijan (`accessbank.az`). Quarantined.
  - `azerconnect`: Outbound career portal uses Oracle Cloud (`fa-emfh-saasfaprod1.fa.ocs.oraclecloud.com`), not Workable. Quarantined.
  - `pasha-insurance`: Career portal uses Teamtailor (`career.pasha-insurance.az`), not Workable. Quarantined.
  - `pasha-capital`, `bakcell`, `unibank`: Outbound ATS links from official sites require direct verification. Disabled pending employer verification.

---

## 2. Hardened Architecture & Defect Remediations

### 1. Unified Stable Per-Employer Source Identity
- **Identities Aligned:**
  - `JobSource.key`: `'pasha-holding'`
  - `ImportRunReportDto.source`: `'pasha-holding'` (matches `/^[a-z][a-z0-9_-]{0,30}$/`, no colons)
  - `job.externalId`: `pasha-holding:${id}` (e.g. `pasha-holding:AAFCBFE72F`)
  - `sourceHealth`: SQL `split_part("externalId", ':', 1)` resolves to `'pasha-holding'`, grouping counts accurately under the registered source row.
  - `closure reconciliation`: Filters by `{ externalId: { startsWith: 'pasha-holding:' } }`, preventing cross-tenant closure leakage.
- **Proven in Real Ingestion:** `original-sources-isolation.e2e-spec.ts` verifies end-to-end that jobs are ingested, reports are recorded, counts match, and re-imports are idempotent.

### 2. Fail-Closed Empty-Listing Detection
- **Workable:**
  - Input `# Unexpected error page` throws `Unrecognized or invalid Workable listing header`, aborts run, and reports `complete: false`.
  - Requires table header (`| Title | ... | Details |`) and separator (`|---|...|---|`), or explicit empty inventory notice (`no open positions|no vacancies|there are currently no`).
  - Throws on malformed rows (does not silently discard malformed rows).
- **Yelo Bank:**
  - Input `<html><h1>Maintenance</h1></html>` or `503 Service Unavailable` throws `Yelo career listing indicates maintenance or error page`.
  - Requires recognized career container (`.vacancies-list`, etc.) or recognized career heading; unknown layouts throw.
  - Validates every vacancy link; malformed slugs throw rather than being silently dropped.

### 3. Immediate Abort on Blocking Responses
- Both `WorkableCollector` and `YeloCollector` detect blocking responses (403 Forbidden, 429 Too Many Requests, or robots denial) during detail fetches.
- Rather than catching and continuing, the collectors immediately stop further requests to that source, mark `report.complete = false`, record the blocking error, and return.

### 4. Accurate Expired Reporting & Honest Adapter Count
- `report.expired` is incremented whenever `job.deadline && new Date(job.deadline) < this.now()`.
- Exactly **8 working verified employer adapters** are configured in `employers-100.json` (SOCAR, Halliburton, ABB, Azercell, EY, PwC, PASHA Holding, Yelo Bank). `audit-employer-sources.spec.ts` strictly asserts 8.
  - *Update, 4 October 2026:* the register is the **original 100 requested employers plus declared, verified additions**. PASHA Insurance (Teamtailor) made 9 adapters and Xsolla (Lever, a verified addition found through the HRX source map) makes **10**, in a register of **101**. The spec now pins the original 100 ids (none may be removed or replaced), requires every id and name to be unique, makes `ADDED_VERIFIED_EMPLOYERS` in `employer-registry.ts` the only way to add an employer (each needs the `official-career-link-checked` evidence, an https career URL, an adapter and a collector under its own key), and counts adapters as the original nine plus those of the additions. The file keeps its historical name `employers-100.json`.

---

## 3. Verified Live Preview Execution Results

### A. PASHA Holding (Workable Collector)
```sh
npx ts-node -P apps/api/tsconfig.build.json apps/api/src/scripts/import-public-jobs.ts --source pasha-holding --max-pages 1 --max-jobs 10 --delay-ms 1500
```
**Output:**
```json
{"preview":true,"externalId":"pasha-holding:AAFCBFE72F","title":"Azərbaycan Supermarket MMC (Bravo) - Baş Auditor","company":"PASHA Holding","location":"Baku, Azerbaijan","url":"https://apply.workable.com/pasha-holding/j/AAFCBFE72F"}
{"preview":true,"externalId":"pasha-holding:42FA7BEF17","title":"Auditor-Agro Dairy","company":"PASHA Holding","location":"Baku, Azerbaijan","url":"https://apply.workable.com/pasha-holding/j/42FA7BEF17"}
{"preview":true,"externalId":"pasha-holding:BDD973568D","title":"Audit Manager","company":"PASHA Holding","location":"Baku, Azerbaijan","url":"https://apply.workable.com/pasha-holding/j/BDD973568D"}
{"preview":true,"externalId":"pasha-holding:9080699011","title":"Aparıcı Auditor - Azərbaycan Supermarket MMC (Bravo)","company":"PASHA Holding","location":"Baku, Azerbaijan","url":"https://apply.workable.com/pasha-holding/j/9080699011"}
{"preview":true,"externalId":"pasha-holding:C81AC3343B","title":"AI Transformation and Governance Manager","company":"PASHA Holding","location":"Baku, Azerbaijan","url":"https://apply.workable.com/pasha-holding/j/C81AC3343B"}
{"mode":"preview","source":"pasha-holding","complete":true,"pages":1,"discovered":5,"fetched":5,"expired":0,"skipped":0,"failed":0,"accepted":5}
```

### B. Yelo Bank (Yelo Collector)
```sh
npx ts-node -P apps/api/tsconfig.build.json apps/api/src/scripts/import-public-jobs.ts --source yelo --max-pages 1 --max-jobs 15 --delay-ms 1500
```
**Output:**
```json
{"preview":true,"externalId":"yelo:534","title":"(Lənkəran filialı) Mikro biznes müştəriləri üzrə təcrübəçi / kiçik mütəxəssis","company":"Yelo Bank","location":"Lənkəran","url":"https://www.yelo.az/az/about-bank/vacancies/?vacancy=yelo-lenkeran-filiali-mikro-biznes-musterileri-uzre-tecrubeci-kicik-mutexessis-534","deadline":"2026-10-15T19:59:59.999Z"}
{"preview":true,"externalId":"yelo:87734642","title":"EVAM platforması üzrə təcrübəçi (EVAM system development intern)","company":"Yelo Bank","location":"Bakı","url":"https://www.yelo.az/az/about-bank/vacancies/?vacancy=yelo-evam-platformasi-uzre-tecrubeci-evam-system-development-intern-87734642","deadline":"2026-10-04T19:59:59.999Z"}
{"preview":true,"externalId":"yelo:27147419","title":"İnzibatı işlər üzrə köməkçi","company":"Yelo Bank","location":"Bakı","url":"https://www.yelo.az/az/about-bank/vacancies/?vacancy=yelo-inzibati-isler-uzre-komekci-27147419","deadline":"2026-11-01T19:59:59.999Z"}
{"preview":true,"externalId":"yelo:55734744","title":"Data analitik (Biznes) / Mütəxəssis / Aparıcı mütəxəssis","company":"Yelo Bank","location":"Bakı","url":"https://www.yelo.az/az/about-bank/vacancies/?vacancy=yelo-data-analitik-biznes-mutexessis-aparici-mutexessis-55734744","deadline":"2026-10-30T19:59:59.999Z"}
{"preview":true,"externalId":"yelo:2204209","title":"Java Developer (Middle)","company":"Yelo Bank","location":"Bakı","url":"https://www.yelo.az/az/about-bank/vacancies/?vacancy=yelo-java-developer-middle-2204209","deadline":"2026-10-02T19:59:59.999Z"}
{"preview":true,"externalId":"yelo:39388342","title":"Girovların qiymətləndirilməsi üzrə mütəxəssis","company":"Yelo Bank","location":"Bakı","url":"https://www.yelo.az/az/about-bank/vacancies/?vacancy=yelo-girovlarin-qiymetlendirilmesi-uzre-mutexessis-39388342","deadline":"2026-10-21T19:59:59.999Z"}
{"preview":true,"externalId":"yelo:2735890","title":"KOB (SME) kreditləri üzrə aparıcı / baş mütəxəssis (Sədərək filialı)","company":"Yelo Bank","location":"Bakı","url":"https://www.yelo.az/az/about-bank/vacancies/?vacancy=yelo-kob-sme-kreditleri-uzre-aparici-bas-mutexessis-sederek-filiali-2735890","deadline":"2026-10-18T19:59:59.999Z"}
{"preview":true,"externalId":"yelo:66016659","title":"KOB (SME) kreditləri üzrə aparıcı / baş mütəxəssis (Lənkaran filialı)","company":"Yelo Bank","location":"Bakı","url":"https://www.yelo.az/az/about-bank/vacancies/?vacancy=yelo-kob-sme-kreditleri-uzre-aparici-bas-mutexessis-lenkaran-filiali-66016659","deadline":"2026-10-18T19:59:59.999Z"}
{"preview":true,"externalId":"yelo:89573","title":"KOB (SME) kreditləri üzrə aparıcı /baş mütəxəssis","company":"Yelo Bank","location":"Bakı","url":"https://www.yelo.az/az/about-bank/vacancies/?vacancy=yelo-kob-sme-kreditleri-uzre-aparici-bas-mutexessis-89573","deadline":"2026-10-17T19:59:59.999Z"}
{"preview":true,"externalId":"yelo:79623277","title":"Data scientist (middle / senior)","company":"Yelo Bank","location":"Bakı","url":"https://www.yelo.az/az/about-bank/vacancies/?vacancy=yelo-data-scientist-middle-senior-79623277","deadline":"2026-10-05T19:59:59.999Z"}
{"mode":"preview","source":"yelo","complete":true,"pages":1,"discovered":10,"fetched":10,"expired":0,"skipped":0,"failed":0,"accepted":10}
```

---

## 4. Verification and Regression Tests

1. **NestJS Build / TypeScript Compilation:**
   ```sh
   npm run build --prefix apps/api
   ```
   **Result:** Clean exit (code 0), 0 errors.

2. **Public Jobs Scrapers Unit Test Suite:**
   ```sh
   npm test --prefix apps/api -- public-jobs
   ```
   **Result:** 10 test suites passed, 252 tests passed:
   - `workable.collector.spec.ts` (42 tests: fail-closed header checks, empty listing fixtures, 403/429 detail abort, date validation, location filtering, per-employer identity)
   - `yelo.collector.spec.ts` (34 tests: maintenance fail-closed, layout checks, malformed slug rejection, 403/429 detail abort, expired tracking, calendar dates)
   - `boss.collector.spec.ts`
   - `smartjob.collector.spec.ts`
   - `work.collector.spec.ts`
   - `public-job-collector.spec.ts`
   - `sap-careers.collector.spec.ts`
   - `pwc.collector.spec.ts`
   - `abb.collector.spec.ts`
   - `import-public-jobs.spec.ts`

3. **100 Employers Audit Test Suite:**
   ```sh
   npm test --prefix apps/api -- audit-employer-sources.spec.ts
   ```
   **Result:** 1 suite passed, 7 tests passed (strictly asserts 8 verified working adapters).

4. **Integration & Isolation Test Suite on Isolated DB:**
   ```sh
   npm run test:e2e --prefix apps/api -- original-sources-isolation.e2e-spec.ts
   ```
   **Result:** 1 suite passed, 6 tests passed:
   - Authenticated ingestion accepts `pasha-holding` and `yelo` jobs.
   - Run reports with `source="pasha-holding"` and `source="yelo"` succeed; colons reject.
   - Source health groups counts by `pasha-holding` and `yelo`.
   - Re-import is safe and idempotent.
   - Closure reconciliation for `pasha-holding` isolates per-employer and leaves `yelo` jobs completely untouched.
   - Reports for unverified/disabled sources are rejected (404).

5. **Existing E2E Test Suites (`public-job-import` & `source-registry`):**
   ```sh
   npm run test:e2e --prefix apps/api -- public-job-import.e2e-spec.ts source-registry.e2e-spec.ts
   ```
   **Result:** 2 suites passed, 18 tests passed.

6. **Database Migration Verification:**
   - **Fresh database:** All 30 migrations applied cleanly without errors.
   - **Upgrade database:** 29 migrations applied, then additive corrective migration `20261011090000_disable_unverified_employer_sources` applied seamlessly without repair or reset.

---

## 5. Integration Instructions for Parallel Claude Agent

To integrate these commits:

```sh
# 1. Fetch the source expansion branch
git fetch origin codex/azerbaijan-source-expansion

# 2. Cherry-pick the source expansion commit:
git cherry-pick <COMMIT_SHA>

# 3. Verify public-jobs tests and typecheck pass:
npm test --prefix apps/api -- public-jobs
npm test --prefix apps/api -- audit-employer-sources.spec.ts
npm run test:e2e --prefix apps/api -- original-sources-isolation.e2e-spec.ts
npm run build --prefix apps/api

# 4. Preview sources (omitting --apply runs read-only preview mode):
npx ts-node -P apps/api/tsconfig.build.json apps/api/src/scripts/import-public-jobs.ts --source pasha-holding --max-pages 1 --max-jobs 10
npx ts-node -P apps/api/tsconfig.build.json apps/api/src/scripts/import-public-jobs.ts --source yelo --max-pages 1 --max-jobs 15
```

---

## 6. Explicit Safety Confirmation

- **No production deployment, migration, or apply command was executed.**
- **No external email was sent, no credentials were leaked or modified.**
- **The email-application checkout at `/Users/fizuli.050icloud.com/Projects/aise-deployment` was completely untouched.**
- **Node modules and Prisma client were never reinstalled or regenerated.**
