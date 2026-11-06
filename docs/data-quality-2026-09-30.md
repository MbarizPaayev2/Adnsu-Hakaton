# Job data quality, deduplication and sources (30 September 2026)

## 1. "Tam ştat" locations

**What happened.** Glorri's detail page lists `company, location, employment type` as bullets. The importer read them by position (`infoItems[1]` = location). When a posting has no location bullet the employment type moves into second place and was stored as the location.

**Production, read-only (`75754ea`):** 118 of 1,215 jobs (114 "Tam ştat", 4 "Yarım ştat"; 116 active, none hidden) — all from the Glorri importer, first seen 30 Aug to 30 Sep. All 118 have an empty `detail.employment_type` and a real place in the listing record (`rawPayload.location`): Bakı 107, Gəncə 5, Bərdə 2, Quba, Zaqatala, Sədərək 1 each. 25 existing matches reference them. No other source is affected (Glorri is the only source).

**Impact.** The candidate app has no free-text location search; the location reaches people as the text on a match card ("Tam ştat" instead of a city) and reaches the scorer, where a city outside the candidate's preferred cities costs ×0.6. So these postings were shown with a wrong place and unfairly down-scored for candidates who prefer Baku (measured: 0.25 lower on the evaluation set, `docs/matching-evaluation.md`).

**Fixes (all in commit `1c33763`):**
- `classifyGlorriInfoItems`: the first bullet is the company, an employment-type label is never a location, anything else is. A missing location stays missing.
- `mapGlorriJobToIngestPayload`: detail location → listing location → country. An employment type is never used; no city is ever guessed. The original record (including the misplaced value) stays in `rawPayload`.
- Scorer: an employment-type string is an unknown place (neutral), as defence in depth.

**Repair (not yet run on production).** `npm run script:repair-glorri-locations` (prod: `node dist/scripts/repair-glorri-locations.js`):
- dry run by default; `--apply` needs `--undo-file`, refuses to overwrite one, writes it owner-only *before* the first change;
- a row qualifies only if it is a Glorri job, its location is an employment-type label, the source's own detail says the same, and the listing has a real place; only `Job.location` changes (compare-and-set per row, so the importer is never overwritten);
- `--rollback <undo-file>` restores exactly what changed;
- uses a bare Prisma client, so no queue workers start.

Evidence: 9 planner unit tests; rehearsal on six synthetic rows in an isolated database (2 repaired, 4 correctly left alone, apply refused without an undo file, second apply refused, rollback restored both); a read-only SQL equivalent against production selects exactly 118 rows and skips 0.

Side effect, stated plainly: the next hourly import sees the corrected location as a content change and rescored those postings once (118 jobs × 11 profiles). Even without running the script, the fixed importer repairs these rows on its first run, because it rebuilds every listed job's location from the stored detail and listing. The script is the controlled, audited, reversible alternative. Matches already stored keep their rows; scores refresh in place.

## 2. Deduplication

Current data, within Glorri: 23 company+title groups; 22 differ in text or address (distinct openings, e.g. several Karaca sales roles). Only 2 groups (4 rows) have identical text: one repost (Avromed, posted 5 days apart) and one pair at the same address (Karaca) that may be two headcounts or a repost. **These are not merged**: a source's own ids are authoritative, so same-source look-alikes are only ever reported as a *possible repost* for a person to judge.

Cross-source rules (`apps/api/src/jobs/job-dedup.util.ts`, unit-tested with 20 cases). A newly seen posting is linked to an earlier, open posting of **another** source only when either
1. destination URLs are equal after normalisation (tracking parameters, fragment, `www`, trailing slash removed; a bare domain names no posting) **and** the company matches **and** the title or the text agrees; or
2. company, title, exact location (not city; unknown never matches) and near-identical text (≥ 0.9 shingle similarity, thin text gives no evidence) agree, and the postings are ≤ 45 days apart.

A link changes only `duplicateOfId`/`duplicateReason`. The duplicate keeps its row, matches, applications and attachments; it is left out of candidate lists, dashboard counts and matching while the primary is open, is released (and queued for matching) when the primary closes or an operator hides it, and every import run runs that sweep. Operators see the link in the listings response. Additive migration `20261003090000_job_deduplication` (4 nullable columns, 3 indexes, one self-key; applies after all 21 earlier migrations with zero drift on a scratch database).

Repeated imports, moderation and outages (real Postgres, `test/job-dedup.e2e-spec.ts`, 6 tests; plus existing importer specs): same posting from two sources → two rows, one primary, matching queued once; re-import → no new rows, no churn; different address/title/same-source → never linked; closing or hiding the primary releases the duplicate and keeps its matches; an operator-hidden posting stays hidden after a source reopen; keys backfill without a content change. Outage safety (already in `glorri-scraper.service.spec.ts`, re-run green): partial listings, malformed pages, failed detail fetches and a shrunken listing never close a job; only a confirmed 404/410 does.

Not proven: behaviour with real multi-source data (there is none yet). Thresholds are deliberately strict; relax them only with examples.

## 3. Sources — what was checked (30 September, public pages only)

Public visibility and a permissive `robots.txt` are **not** permission to copy or automate. Nothing was crawled; only `robots.txt`, the rules/about pages and the home page were read once each.

| Source | robots.txt | Terms / rules found | Feed, API, partner route found | Assessment |
|---|---|---|---|---|
| hellojob.az | `Allow: /`, sitemap | `/page/qaydalar`: prohibits passing CV data to third parties; reserves its own rights to vacancy/CV data; mentions one named partner (isbu.az) | none | **No** without a written agreement |
| boss.az | blocks admin/login/profile areas, sitemap | no terms link on the home page; we could not locate any | none | **No**. AISE previously removed boss.az jobs (`cleanup-bossaz-jobs`). Ask in writing first |
| jobsearch.az | `Allow: /` | no terms link on the home page (only About/Contact) | none; a paid "Elan yerləşdir" route exists for employers | **No** until they answer |
| ejob.az | blocks account/upload areas; slows AI crawlers | rules: moderated posts, may change terms at will; privacy page | none | **No** until they answer |
| busy.az | — | not reviewed | — | **Do not add without permission** (your instruction) |

Recommendation: ask each of the four (contact pages above) for a written feed or partner agreement: what may be shown, attribution, refresh rate, and whether candidates may be sent to their page to apply. Until one says yes, add no source. A source is also worth little until the free-native-MVP proves that candidates want more listings; AISE's own employer postings are the product.

## 4. Glorri

Your decision stands and is recorded: the existing hourly importer keeps running; it was **not** changed, expanded, or given a new schedule by this work. Glorri's published terms (§8, §9) prohibit automated access and commercial reuse without written permission, and no permission exists. Your choice is not Glorri's authorisation. The draft request is `docs/glorri-partner-request.md`. Until Glorri answers: no wider crawling, no live auto-apply, no claim of permission in product copy.
