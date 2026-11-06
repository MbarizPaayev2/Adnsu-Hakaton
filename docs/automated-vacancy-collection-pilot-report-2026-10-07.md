# AISE Automated Vacancy-Collection Pilot & Verification Report (Final Handoff)

**Audit Date:** 2026-10-07  
**Branch:** `codex/vacancy-growth`  
**Commit SHA:** `996fb90`  
**Workspace:** `/Users/fizuli.050icloud.com/Projects/aise-vacancy-growth`  
**Production Guardrail:** `SOURCE_SCHEDULE_ENABLED=false` is preserved. No automated background schedules or collection runs are enabled in production.

---

## 1. Census Reconciliation & Mutually Exclusive Exclusions

### 1.1. Authoritative Backend Actionable Predicate
From [`apps/api/src/jobs/jobs.service.ts`](file:///Users/fizuli.050icloud.com/Projects/aise-vacancy-growth/apps/api/src/jobs/jobs.service.ts):
```sql
status = 'ACTIVE' 
  AND "hiddenAt" IS NULL 
  AND "duplicateOfId" IS NULL 
  AND (deadline IS NULL OR deadline >= NOW())
```

### 1.2. Exact Mathematical Reconciliation
A naive subtraction of totals yields:
$$\text{Total Stored } (2,736) - \text{Expired } (943) - \text{Total Duplicates } (48) = 1,745$$
However, the measured actionable count is **1,755** ($+10$). 

**Root Cause:** Exactly **10 duplicate rows also have an expired deadline (`deadline < NOW()`)**. Naive subtraction subtracted these 10 rows twice.

### 1.3. Mutually Exclusive Partition (Exact SQL)
Verified by read-only query against `127.0.0.1:5433/aise_census_growth_test`:

```sql
SELECT
  COUNT(*) AS total_stored,
  COUNT(*) FILTER (WHERE status != 'ACTIVE' OR "hiddenAt" IS NOT NULL) AS inactive_or_hidden,
  COUNT(*) FILTER (WHERE status = 'ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline >= NOW())) AS actionable,
  COUNT(*) FILTER (WHERE "duplicateOfId" IS NULL AND deadline < NOW()) AS expired_non_duplicate,
  COUNT(*) FILTER (WHERE "duplicateOfId" IS NOT NULL AND (deadline IS NULL OR deadline >= NOW())) AS duplicate_unexpired,
  COUNT(*) FILTER (WHERE "duplicateOfId" IS NOT NULL AND deadline < NOW()) AS duplicate_expired
FROM "Job";
```

#### Mutually Exclusive Results:
| Partition Bucket | Condition | Count |
|---|---|---|
| **1. Actionable (Open Unique Unexpired)** | `status='ACTIVE' AND hiddenAt IS NULL AND duplicateOfId IS NULL AND (deadline IS NULL OR deadline >= NOW())` | **1,755** |
| **2. Expired Non-Duplicate** | `duplicateOfId IS NULL AND deadline < NOW()` | **933** |
| **3. Duplicate Expired (Overlap)** | `duplicateOfId IS NOT NULL AND deadline < NOW()` | **10** |
| **4. Duplicate Unexpired (Excluded Duplicates)** | `duplicateOfId IS NOT NULL AND (deadline IS NULL OR deadline >= NOW())` | **38** |
| **5. Inactive / Hidden** | `status != 'ACTIVE' OR hiddenAt IS NOT NULL` | **0** |
| **Total Stored Rows** | $\mathbf{1,755 + 933 + 10 + 38 = 2,736}$ | **2,736** |

#### Reconciliation Identity:
$$\text{Total Stored } (2,736) - \text{Total Expired } (943) - \text{Unexpired Duplicates Only } (38) = \mathbf{1,755}$$

All 10 overlapping duplicate-expired rows belong to `hellojob` (where cross-source duplicate linking matched postings whose original application deadlines subsequently elapsed).

---

## 2. Currently Verified Freshness vs. Historical Listing Evidence

A complete listing run on October 2 demonstrates evidence that a vacancy existed on October 2; it does **not** prove that the vacancy remains open today (October 7). The 1,755 actionable postings fall into three distinct temporal categories:

| Freshness Category | Description | Sources & Postings | Total Open Actionable |
|---|---|---|---|
| **A. Currently Verified Fresh (Live Today, 2026-10-07)** | Sighted in a successful, verified-complete listing run today. | `pasha-insurance`: 37<br>`xsolla`: 40 | **77** |
| **B. Historically Verified Complete (Stale, 2026-10-02)** | Sighted in a complete run 5 days ago; unverified since. | `abb`: 54<br>`socar`: 28<br>`yelo`: 7<br>`azercell`: 6<br>`pasha-holding`: 5<br>`pwc`: 2<br>`halliburton`: 1 | **103** |
| **C. Freshness Unknown (Partial Crawls / Never Completed)** | Postings from job boards or partial runs where no verified-complete listing ever succeeded. | `hellojob`: 513<br>`boss`: 399<br>`work`: 375<br>`smartjob`: 283<br>`pasha-insurance` (items absent from today's feed): 4<br>`xsolla` (items absent from today's feed): 1 | **1,575** |
| **Total Actionable** | | | **1,755** |

Under AISE's safe lifecycle rules (`CLOSE_AFTER_COMPLETE_MISSES = 2`), vacancies in Category B and C are kept `ACTIVE` because incomplete, failed, or partial runs are strictly prohibited from closing vacancies. However, only Category A (77 postings) has affirmative proof of being live today.

---

## 3. Scope of Measured Inventory (No Third-Party Speculation)

Claims regarding third-party aggregator volumes (such as HRX or BirJob reporting 4,000+ vacancies) are excluded from AISE's operational metrics:
- **HRX and BirJob are not integrated into AISE.** They have not been crawled, ingested, or measured in this codebase.
- AISE's census is based **strictly on the 22 registered sources** in its database.
- Within these registered sources, the total actionable inventory measures exactly **1,755** postings.
- Claims of 5,000 active Azerbaijani vacancies cannot be made unless and until additional sources are integrated, deduplicated, and mathematically verified.

---

## 4. Pilot Budget Semantics & Verification (Xsolla 185 Discovered vs. Budget)

In the secondary canary collector ([`LeverCollector`](file:///Users/fizuli.050icloud.com/Projects/aise-vacancy-growth/apps/api/src/scrapers/public-jobs/lever.collector.ts)):
```typescript
const feed = parseLeverFeed(tenant, rawJson, this.now());
report.discovered = feed.discovered; // Total global roles in JSON (185)
report.fetched = feed.discovered;
...
for (const job of feed.jobs.slice(0, options.maxJobs)) { // Filtered Azerbaijan roles (40)
  await accept(job);
  report.accepted++;
}
report.complete = !feed.failed && feed.jobs.length <= options.maxJobs;
```

### Analysis:
1. `feed.discovered` (185) represents the total unfiltered global items returned by `https://api.lever.co/v0/postings/xsolla?mode=json`.
2. `feed.jobs` (40) represents the in-scope roles matching Baku/Azerbaijan.
3. The slicing and completeness check compare `feed.jobs.length` against `options.maxJobs`, **not** `feed.discovered`.
4. With `options.maxJobs = 150`, `40 <= 150` evaluates to `true`, and the run is marked `complete: true`.
5. **Budget Refinement:** Because Lever returns the entire multitenant array in a single HTTP response (1 network round-trip), capping `maxJobs` at 150 provides no network savings. To prevent future false-incomplete runs if Xsolla expands Baku hiring beyond 150 roles, the pilot budget for Xsolla is set to `maxJobs = 200` (`EMPLOYER_BUDGET.maxPages = 5`, `delayMs = 2000`).

---

## 5. Scheduler Isolation Proof, Independent Controls, Alerting, & Recovery

### 5.1. Proof That Allowlist Prevents Other Sources from Running
When `SOURCE_SCHEDULE_ENABLED=true` is set, `SourceScheduler.claim()` executes the following query:
```typescript
const due = await this.prisma.jobSource.findMany({
  where: {
    key: { not: 'glorri' },
    enabled: true,
    scheduled: true,             // <-- HARD FILTER: Only sources with scheduled=true
    schedulePausedAt: null,      // <-- Excludes paused sources
    accessReview: { not: 'RESTRICTED' },
    OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    AND: [
      { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      { OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }] },
    ],
  },
  orderBy: [{ nextRunAt: 'asc' }, { key: 'asc' }],
  take: 5,
});
```
- In the database, 21 out of 22 sources currently have `scheduled: false`.
- If only `pasha-insurance` is set to `scheduled = true`, **only `pasha-insurance` can be selected by `claim()`**. Every other source is excluded by the SQL predicate and will never run.

### 5.2. Independent Pause Controls
Two orthogonal tiers of pause controls exist:
1. **Global Emergency Pause**:
   - `PUT /admin/ops/scheduler/pause` (sets feature flag `import.scheduled = paused`).
   - Checked at the entry of `SourceScheduler.tick()` and `runSourceNow()`.
   - Stops all scheduling immediately without modifying source configurations.
2. **Individual Source Pause**:
   - `PUT /admin/ops/sources/:key/schedule` with `{ paused: true }`.
   - Sets `JobSource.schedulePausedAt = NOW()`.
   - Excludes that specific source from `claim()` while all other scheduled sources continue.

### 5.3. Real Alert Delivery Status
- **Implemented**: Structured log events (`event: 'source_cooldown_started'`, `event: 'source_collection_failed'`) and visual operational pills in `/admin/sources`.
- **Not Implemented**: No outbound webhook, Slack, Telegram, or email alert dispatcher exists for crawler failures. Operators must monitor structured logs or the `/admin/sources` dashboard.

### 5.4. Recovery Rules for Blocked Sources
- **Circuit Breaker Policy**: Any HTTP 403 / Cloudflare challenge (`BLOCKED`) or 5 consecutive failures immediately sets:
  - `cooldownUntil = NOW() + 24 hours` (doubles on repeat up to 7 days).
  - `cooldownReason = 'BLOCKED: 403 Forbidden'`.
- **No Repeated Hammering**: During cooldown, `claim()` skips the source and `runSourceNow()` returns HTTP 409. The upstream host is never contacted.
- **Probe Rule**: After `cooldownUntil` expires, the source is granted exactly **one single probe run**. If that run fails, it escalates back into cooldown immediately.
- **Operator Recovery**: Only an authenticated operator with `ops.control` can call `POST /admin/ops/sources/:key/recover` to deliberately reset the cooldown and failure counter (logged with audit event `SOURCE_COOLDOWN_RESET`).

---

## 6. Separation of Implemented Controls vs. Proposed Configuration

### 6.1. Implemented System Controls (Live in Codebase)
1. **Single Source Leases**: `SourceLeaseService` enforces database-level CAS leases (`leaseOwner`, `leaseUntil`, `leaseHeartbeatAt`) across CLI, scheduler, and manual runs.
2. **Resumable Traversal**: `SourceDiscoveryProgress` stores positional page cursors and 10-item anti-shift anchors.
3. **Safe Closures**: Requires 2 consecutive verified-complete listings (`CLOSE_AFTER_COMPLETE_MISSES = 2`). Partial, crashed, or errored runs skip closure reconciliation (`closureSkipped = 'listing_incomplete'`).
4. **Content Error Tolerance**: Up to 10% unparseable detail pages are tolerated without failing the run or dropping discovery progress.
5. **Admin Operations**: `/admin/sources` surfaces real backend states (`HEALTHY`, `RUNNING`, `COOLING_DOWN`, `PAUSED`, `DEGRADED`) with recovery controls.

### 6.2. Proposed Pilot Configuration (Not Enabled; Pending Signoff)
```typescript
export const PROPOSED_PILOT_CONFIG = {
  globalSwitch: 'SOURCE_SCHEDULE_ENABLED=true', // Currently false
  canarySource: 'pasha-insurance',
  canarySettings: {
    scheduled: true,             // Currently false
    intervalMinutes: 1440,       // 24 hours
    limits: { maxPages: 1, maxJobs: 50, delayMs: 2000 },
  },
  secondaryCanary: 'xsolla',
  secondarySettings: {
    scheduled: true,             // Currently false
    intervalMinutes: 1440,       // 24 hours
    limits: { maxPages: 1, maxJobs: 200, delayMs: 2000 },
  },
};
```

### 6.3. Source Restrictions & Legal Posture
- Technical access (HTTP 200) and crawler directives (`Content-Signal: search=yes, ai-input=yes`, `Allow: /jobs.rss`) signal search discoverability and retrieval permission.
- **They do NOT constitute an affirmative commercial republication license or copyright transfer.**
- Founder signoff is an internal business decision to operate under search engine indexation guidelines; it does not represent third-party contractual consent.
- `JobSource.accessReview` remains at `ROBOTS_ALLOWED_TERMS_PENDING` until a documented legal terms review is completed.

---

## 7. Concrete Pilot Readiness Checklist

- [x] **Database Migrations Deployed**: Additive columns `leaseOwner`, `cooldownUntil`, `SourceDiscoveryProgress` applied.
- [x] **Acquisition Trial Verified**: Real scheduler, crash recovery (`SIGKILL`), lease recovery, and resume tested with zero duplicates.
- [x] **Census Reconciled**: 1,755 actionable postings mathematically reconciled against 943 expired and 38 unexpired duplicates.
- [x] **Canary Collectors Validated**: Live bounded collection for `pasha-insurance` (+6 new roles) and `xsolla` (+3 new roles) verified.
- [x] **Admin State Verification**: `/admin/sources` tested across `HEALTHY`, `RUNNING`, `COOLING_DOWN`, and `PAUSED`.
- [ ] **Founder Terms Review**: Formal review of `pasha-insurance` terms before advancing `accessReview` to `TERMS_REVIEWED_ALLOWED`.
- [ ] **Production Activation**: Setting `scheduled = true` for `pasha-insurance` and enabling `SOURCE_SCHEDULE_ENABLED=true` in production environment.
