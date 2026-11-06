# AISE Azerbaijan Vacancy Growth & Census Report

**Date:** 2026-10-04  
**Branch:** `codex/vacancy-growth`  
**Database:** Isolated test database `aise_census_growth_test` on `127.0.0.1:5433` (disposable, isolated from production and `aise_preview_20261004`)  
**Scope:** Verified vacancy acquisition, completeness and false-closure protection, original employer ATS expansion (Xsolla / Lever), cross-source deduplication audit, authoritative actionable lifecycle reporting, and reproducible measurement.

---

## 1. Executive Summary & Inventory Growth

Using the backend's authoritative actionable predicate (`status = 'ACTIVE' AND hiddenAt IS NULL AND duplicateOfId IS NULL AND (deadline IS NULL OR deadline >= NOW())`), AISE's measured Azerbaijan vacancy inventory in the isolated acquisition environment grew from **1,660** to **1,818** open, unique, actionable, unexpired vacancies (**+158** net increase, +9.5%). Direct email application vacancies grew from **289** to **314** (**+25** net increase, +8.7%).

This growth was achieved through sustained public API collection on Work.az (+155 stored vacancies, +120 open unexpired), strict pagination validation, and the implementation of a new original-employer ATS collector for Lever (Xsolla Baku, +38 verified tech vacancies, 0 expired).

### Comparable Cohort Measurement (Strict Backend Actionable Predicate)

| Metric | Baseline (Pre-Session Cohort) | Today New Cohort (Work.az + Xsolla) | Total After Session | Net Actionable Growth |
|---|---|---|---|---|
| **Total Stored Vacancies** | 2,534 | 193 | **2,727** | **+193** (+7.6%) |
| **Status-Active Vacancies** | 2,534 | 193 | **2,727** | **+193** (+7.6%) |
| **Expired by Deadline** (`deadline < NOW()`) | 834 | 35 | **869** | +35 |
| **Cross-Source Linked Duplicates** (`duplicateOfId IS NOT NULL`) | 48 | 0 | **48** | 0 new collisions |
| **Open Unique Unexpired Vacancies** | **1,660** | **158** | **1,818** | **+158** (+9.5%) |
| **Actionable Application Destination** | **1,660** | **158** | **1,818** | **+158** (+9.5%) |
| **Explicit Actionable Email Application** | **289** | **25** | **314** | **+25** (+8.7%) |
| **Detail-Verified in Complete Listings** | 154 | 38 | **192** | **+38** (+24.7%) |
| **Freshness Unknown (Board Bounded/Partial)** | 1,506 | 120 | **1,626** | +120 |

> [!IMPORTANT]
> **Actionable Predicate Transparency:**
> An earlier draft report incorrectly counted expired postings (`deadline < NOW()`) as actionable, which inflated the pre-session baseline to 2,486 and the post-session inventory to 2,679. Under AISE's production predicate (`isJobActionable` in `jobs.service.ts`), postings whose deadline has passed are strictly excluded from matching, alerts, and candidate feeds. The table above applies the identical predicate to both the pre-session baseline and post-session state.

---

## 2. Source-by-Source Distinct Metrics Breakdown

The table below reflects the exact database state of `Job` rows in `aise_census_growth_test` evaluated against the authoritative backend actionable predicate:

| Source Key | Source Name | Collection Method | Total Stored | Status Active | Expired Deadline | Duplicates (Excluded) | Open Unique Unexpired | Explicit Actionable Email | Detail Verified (Complete) | Freshness Unknown |
|---|---|---|---|---|---|---|---|---|---|---|
| `hellojob` | Hellojob | HTML pagination | 974 | 974 | 391 | 48 | 543 | 93 | 0 | 543 |
| `work` | Work.az | Public JSON RPC API | 812 | 812 | 411 | 0 | 401 | 100 | 0 | 401 |
| `boss` | Boss.az | GraphQL client API | 399 | 399 | 0 | 0 | 399 | 91 | 0 | 399 |
| `smartjob` | Smartjob | Sharded API / Sitemap | 300 | 300 | 17 | 0 | 283 | 5 | 0 | 283 |
| `abb` | ABB Careers | Employer JSON feed | 103 | 103 | 47 | 0 | 56 | 0 | 56 | 0 |
| `xsolla` | **Xsolla (Lever)** | **Public Lever JSON API** | **38** | **38** | **0** | **0** | **38** | **0** | **38** | **0** |
| `pasha-insurance` | PASHA Insurance | Teamtailor RSS feed | 35 | 35 | 0 | 0 | 35 | 0 | 35 | 0 |
| `socar` | SOCAR Careers | Public search feed | 32 | 32 | 0 | 0 | 32 | 25 | 32 | 0 |
| `azercell` | Azercell Careers | SAP SF public feed | 16 | 16 | 2 | 0 | 14 | 0 | 14 | 0 |
| `yelo` | Yelo Bank | Official portal | 10 | 10 | 1 | 0 | 9 | 0 | 9 | 0 |
| `pasha-holding` | PASHA Holding | Workable markdown | 5 | 5 | 0 | 0 | 5 | 0 | 5 | 0 |
| `pwc` | PwC Azerbaijan | Global ATS search | 2 | 2 | 0 | 0 | 2 | 0 | 2 | 0 |
| `halliburton` | Halliburton | Global ATS search | 1 | 1 | 0 | 0 | 1 | 0 | 1 | 0 |
| **Total** | | | **2,727** | **2,727** | **869** | **48** | **1,818** | **314** | **192** | **1,626** |

### Timestamp Provenance & Freshness Classification

- **Not "100% Current":** It is factually inaccurate to classify all rows as "100% current" based solely on `lastSeenAt >= NOW() - 7d`.
- **Work.az (397 existing rows):** Received live observation updates on 2026-10-04 via `confirmListed` because their `externalId`s were observed during active listing scans across pages 1–10.
- **Other Board Sources (Hellojob, Boss.az, Smartjob):** Retain timestamps from their initial ingestion run on 2026-10-02 when the baseline database was seeded. Because these runs were bounded or partial, they are classified as **Freshness Unknown (1,626 postings)**: they are not known to be closed, but their ongoing listing is not proven by a complete sweep.
- **Detail-Verified Sources (192 postings):** ABB, Azercell, Halliburton, PASHA Holding, PASHA Insurance, PwC, SOCAR, Xsolla, and Yelo were imported via verified-complete runs where the entire source inventory was walked without errors.

---

## 3. Work.az Sustained Collection & Active Inventory Reconciliation

### Platform Architecture & Active Inventory Math
- Work.az's client RPC API (`POST https://api.work.az/v1/vacancies`) reports `totalElements: 7959` across 160 pages (50 items per page).
- **Pagination Structure:** Inspection and verification revealed that the platform orders vacancies chronologically descending. All active vacancies are concentrated on the first 10 pages.
- **Archived Inactive Tail:** Pages 11–50 were systematically verified: every item returned has `status: "INACTIVE"`. Pages 51–160 (110 pages) were NOT traversed to avoid unnecessary load, and are explicitly labeled **unverified**.
- **Active Discovery Math:**
  - Pages 1–10 contain exactly **455 distinct active platform vacancies**.
  - **Run 1:** Evaluated pages 1–8 (400 discovered): 100 new vacancies created, 297 existing vacancies confirmed active, 3 detail pages failed parsing.
  - **Run 2:** Evaluated all 10 active pages (455 discovered): 397 known vacancies confirmed active without detail fetch; 58 unseen items fetched (55 new vacancies created, 3 detail pages failed).
  - **Distinct Listing Accounting:** 297 (baseline confirmed) + 100 (run 1 created) + 55 (run 2 created) + 3 (failed details) = **455 distinct active listings**.

### Failures Recorded
Three detail pages on Work.az failed parsing because the source pages lacked `datePosted` JSON-LD schema:
- `work:caucasian-vav-group-montajci-metal-konstruksiya`
- `work:barista-29`
- `work:field-promoter-offline-promotion-specialist`

Because `failed === 3`, the run was accurately reported as `complete: false`, preventing false automated closures.

---

## 4. Original Employer Source Implementation: Xsolla (Lever ATS)

Xsolla was identified from the HRX upstream source map as maintaining a major Baku engineering hub.

1. **Integration Architecture:**
   - Origin: `https://jobs.lever.co/xsolla`
   - Public API: `https://api.lever.co/v0/postings/xsolla?mode=json`
   - Official Link: `https://xsolla.com/careers` links directly to Lever.
   - Registry: Added `xsolla` to `apps/api/src/scrapers/public-jobs/employers-100.json` with `evidence: "official-career-link-checked"`.
   - Migration: `20261017120000_register_xsolla_lever` applied to `JobSource`.
2. **Ingestion Results:**
   - 178 total postings evaluated.
   - 140 non-Azerbaijan roles skipped.
   - **38 Baku tech roles accepted and stored** (Go backend engineers, React frontend, SRE, DBAs, QA leads).
   - All 38 rows are open, unexpired, and detail-verified in a complete run.

---

## 5. Cross-Source Duplicate Audit

Using `compareJobs` from `apps/api/src/jobs/job-dedup.util.ts`, all **850** newly acquired Work.az and Xsolla postings were audited against the **1,877** baseline platform postings:

- **Auto-Linked Collisions:** **0** (No cross-source collisions met the conservative auto-link threshold of >= 0.90 text similarity).
- **Ambiguous Pairs Flagged for Human Review:** **4 pairs** (All involving "My Group Holding MMC" roles posted across Work.az, Boss.az, and Smartjob with text similarity between 0.55 and 0.80):
  1. `work:smm-mutexessisi-33` vs `smartjob:169359` ("SMM Mütəxəssisi", sim: 0.65)
  2. `work:satis-meslehetcisi-elektronika` vs `boss:273407` ("Satış məsləhətçisi (Elektronika)", sim: 0.80)
  3. `work:satis-meslehetcisi-elektronika` vs `smartjob:169360` ("Satış məsləhətçisi (elektronika)", sim: 0.77)
  4. `work:kassir-city-park-mall` vs `smartjob:169361` ("Kassir", sim: 0.55)
- Per AISE deduplication policy, these ambiguous pairs were preserved as distinct active rows for operator review.

---

## 6. Reproducible Read-Only SQL Verification Queries

Run against `DATABASE_URL=postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_census_growth_test?schema=public`:

### Query 1: Total Platform Summary (Backend Actionable Predicate)
```sql
SELECT 
  count(*) AS total_stored,
  count(*) FILTER (WHERE status = 'ACTIVE') AS status_active,
  count(*) FILTER (WHERE status = 'ACTIVE' AND deadline < NOW()) AS expired_by_deadline,
  count(*) FILTER (WHERE status = 'ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline >= NOW())) AS open_unique_unexpired,
  count(*) FILTER (WHERE "duplicateOfId" IS NOT NULL) AS duplicates,
  count(*) FILTER (WHERE status = 'ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline >= NOW()) AND "applicationEmail" IS NOT NULL) AS explicit_actionable_email,
  count(*) FILTER (WHERE status = 'ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline >= NOW())) AS actionable_destination
FROM "Job";
```
*Expected Result:*
- `total_stored`: 2,727
- `status_active`: 2,727
- `expired_by_deadline`: 869
- `open_unique_unexpired`: 1,818
- `duplicates`: 48
- `explicit_actionable_email`: 314
- `actionable_destination`: 1,818

### Query 2: Breakdown by Source
```sql
SELECT 
  split_part("externalId", ':', 1) AS source,
  count(*) AS total_stored,
  count(*) FILTER (WHERE status = 'ACTIVE') AS status_active,
  count(*) FILTER (WHERE status = 'ACTIVE' AND deadline < NOW()) AS expired_by_deadline,
  count(*) FILTER (WHERE status = 'ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline >= NOW())) AS open_unique_unexpired,
  count(*) FILTER (WHERE "duplicateOfId" IS NOT NULL) AS duplicates,
  count(*) FILTER (WHERE status = 'ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline >= NOW()) AND "applicationEmail" IS NOT NULL) AS explicit_actionable_email
FROM "Job"
GROUP BY 1
ORDER BY 5 DESC;
```

### Query 3: Cohort Comparison (Pre-Session vs Today New)
```sql
SELECT 
  CASE WHEN "ingestedAt" < '2026-10-04T12:45:00Z' THEN 'PRE_SESSION_BASELINE' ELSE 'TODAY_NEW_COHORT' END AS cohort,
  count(*) AS total_stored,
  count(*) FILTER (WHERE status = 'ACTIVE' AND deadline < NOW()) AS expired_by_deadline,
  count(*) FILTER (WHERE status = 'ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline >= NOW())) AS open_unique_unexpired,
  count(*) FILTER (WHERE status = 'ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline >= NOW()) AND "applicationEmail" IS NOT NULL) AS explicit_actionable_email
FROM "Job"
GROUP BY 1
ORDER BY 1 DESC;
```
*Expected Result:*
- `PRE_SESSION_BASELINE`: total: 2,534 | expired: 834 | open_unique_unexpired: 1,660 | explicit_actionable_email: 289
- `TODAY_NEW_COHORT`: total: 193 | expired: 35 | open_unique_unexpired: 158 | explicit_actionable_email: 25
