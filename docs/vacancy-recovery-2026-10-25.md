# Vacancy recovery and employer expansion — 25 October 2026

## Measured production baseline

The acquisition snapshot at `2026-10-25T09:53:57Z` uses the existing `actionableJobWhere()` predicate: ACTIVE, not hidden, not duplicate-linked, and no elapsed deadline.

- 1,484 actionable postings, 309 normalized employers.
- 19 explicitly email-applicable postings from 13 employers.
- Coverage report: 1,157 backed by a verified-complete listing; 327 without that completeness evidence. “Open” is not a guarantee of freshness.
- HelloJob: 83 open records, four consecutive failures; last run stopped before reading postings with `Unsupported public source URL` and its next attempt was backed off to 25 October at 22:10 UTC.
- Smartjob: collecting successfully in bounded segments, 30 new postings in its last observed run; sitemap presence is discovery evidence, not a complete active census.
- Glorri's recurring single-detail failure was traced to an upstream HTTP 500 for one anonymous posting; the rest of its hourly list is processing. No source-wide reset or invented employer is applied.
- AzerGold: recent connection failures reproduced from the Mac. TLS/network protection is not bypassed; upstream reachability remains unresolved.

Snapshots and raw public-source probe responses stay outside Git under `/tmp/aise-acquisition-20261025/`. No candidate records are included.

## Repairs

1. **HelloJob list redesign.** Recognize the new `İş elanları 2026` heading and the paginated `Vakansiyalar — səhifə N` heading, checking N against the requested page, as well as the legacy heading. Rotating source-owned `.vfp` talent-pool promotions ending `#apply` are excluded, never visited or counted as jobs. Unexpected/foreign cards still fail validation; an empty/unknown layout never proves closure.
2. **HelloJob detail redesign.** Recognize `.vp__hero-main` and span-based publication metadata, preserving old `.vp__head` support. Read only the posting's own body and explicit facts, excluding sidebar contacts and promotions.
3. **Legacy slug identity.** A numeric slug suffix is not always the advert ID. Bind a modern response using an exact source-owned canonical URL where provided; reject another posting's canonical. Without canonical evidence, retain the prior numeric check.
4. **Failure diagnostics.** HelloJob and Smartjob now invoke `onFailedDetail` with the failed posting and reason. This connects them to the scheduler's existing small-content-failure tolerance. No new tolerance is introduced, transport failures still stop collection, and partial runs still cannot close jobs.
5. **Agent-specific robots pacing.** Parse delays but enforce only those in the applicable agent group. A delay for Bytespider or GPTBot must not block AISE. Applicable delays still require explicit enforcement, and private-path restrictions remain intact.

## Employer addition through an existing integration

Add `bp-azerbaijan` to the existing Workday collector and employer registry, with a daily schedule inserted only if no operator-managed source row already exists. Support BP's observed `RQ` requisition IDs alongside Baker Hughes' `R` IDs; stable external identity excludes the optional URL suffix.

Ownership evidence: [BP's official posting](https://careers.bp.com/job-description/RQ117127) links to `https://bpinternational.wd3.myworkdayjobs.com/bpCareers`. The tenant's robots disallows `/bpCareers/` candidate pages but does not restrict the public `/wday/cxs/` search/detail endpoints used by this adapter. No candidate, sign-in or application route is fetched. Country must be explicitly `Azerbaijan`; a fuzzy search match elsewhere is excluded.

Live preview: **two Azerbaijan postings, complete one-page search, two details accepted, zero failures**. These are source postings, not a promise of two net-new unique jobs before ingestion/deduplication. Access review remains `ROBOTS_ALLOWED_TERMS_PENDING`; no republication licence is claimed.

## Validation

- HelloJob's initial repaired three-posting preview: three accepted, zero failures; 80 real links discovered, campaign cards excluded.
- A larger preview revealed the legacy slug mismatch. After the canonical identity correction, the final live preview accepted **40 postings from 33 employers, zero failures**, out of 80 discovered links. It was deliberately capped and does not prove the full source inventory. Those are represented employers, not 33 confirmed new AISE employers.
- An additional live listing-only traversal read two pages / 160 links and continued to page three without fetching details; this is pagination evidence, not 160 validated or imported jobs.
- API suite before the final paginated-heading regression: 132 suites / 2,051 tests passed; the final focused suite passed 62 tests. API build passed.
- Web suite: 98 suites / 627 tests passed. Also fixes the article clipboard test's async race by waiting for rendered feedback, enabling the pending article release to share this batch.
- Regression coverage includes current/legacy layouts, rotating promotions never fetched, unsafe/unknown cards, exact/mismatched canonical identity, robots agent selection, detail-failure callbacks, BP requisition IDs, country filtering and restricted candidate routes never fetched.

## Release and recovery procedure

Release this reviewed change with the already-merged article increment; do not restart the failed #115 controller. Preserve unrelated open PRs. Use exact commit CI, fresh backup/restore, prebuilt-image deployment and verification. Add `bp-azerbaijan` to the host's approved source-monitor list with a crontab backup.

After deployment, run one bounded HelloJob catch-up using the existing leased CLI (200 detail ceiling, normal 1.5-second spacing). Record accepted/failed counts; partial runs never infer closures. Once a healthy recovery is demonstrated, clear only HelloJob's old parser-failure backoff with an audit entry so its normal scheduler resumes. Do not reset blocked/restricted sources or overwrite a live lease.

Collect another acquisition snapshot with the same predicate and compare normalized employers, unique actionable postings and explicitly supported email routes. Net figures may also reflect ordinary expiry and other scheduled collectors; distinguish recovered-source contribution from total inventory movement. Existing recommendation relevance gates, quotas and candidate approval remain unchanged.

## Discovery decisions

Recovering a broken multi-employer board has higher immediate yield than building many bespoke small-employer scrapers. BP reuses an existing adapter; no new dependency, browser runtime or AI call is added. PwC preview returned one active role; EY's current search returned one out-of-country result and accepted none, so neither was enabled merely to inflate source counts. Restricted eJob/JobSearch and other held sources stay held. Smartjob's disallowed `/api/` endpoints are not used to bypass its public listing limitations.
