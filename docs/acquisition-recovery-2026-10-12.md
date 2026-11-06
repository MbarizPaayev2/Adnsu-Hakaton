# Acquisition recovery, 12 October 2026

## Verified production state

SSH access recovered without host changes. At 05:07 UTC (09:07 Baku), production
was healthy at `e4067e6979beeac5ae1e4f287aead25c6cf33fa0`. Database and Redis
readiness passed; the public catalogue and the database agreed on 1,526 actionable jobs.

The same backend predicate was used before and after:

```sql
status = 'ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL
AND (deadline IS NULL OR deadline >= now())
```

| Measure | 11 Oct, 20:51 UTC | 12 Oct, 05:07 UTC | Change |
| --- | ---: | ---: | ---: |
| Actionable postings | 1,262 | 1,526 | +264 |
| Distinct normalized employer names (`companyKey`) | 130 | 296 | +166 |
| Actionable email postings, seen within 30 days | 1 | 15 | +14 |
| Closed | 443 | 443 | 0 |
| Excluded duplicates (before deadline exclusion) | 2 | 16 | +14 |
| Past deadline, excluding closed/duplicates | 69 | 146 | +77 |
| Stored | 1,776 | 2,131 | +355 |

Reconciliation: **355 new stored − 77 additional expired − 14 additional
duplicates = 264 additional actionable**. Distinct normalized employer names
are not independently verified legal entities. Freshness, expiration and imports
continue changing these measurements.

## Overnight runs and HTTP 500

- ABB `cmv4b485000013wl6hq4r1rj3`: succeeded, complete listing of 106,
  56 created, 60 expired, zero closures.
- HelloJob `cmv4cjnz900002avha45pem04`: partial, 100 listed, 99 created,
  `Source HTTP 500`; no detail failures or closures recorded. It is in backoff,
  with the next run scheduled for 12 Oct, 21:44 UTC.
- SmartJob `cmv4cwj22006q2avhtz0n1x68`: bounded partial, 618 discovered,
  200 created, 26 expired, no detail failures or closures.
- SmartJob `cmv4q4clj00r82avhj568fx8f`: subsequent bounded partial,
  590 discovered, zero created, 120 unchanged, no failures or closures.

Two read-only probes using the deployed HelloJob collector fetched robots,
listing pages 1–2 and one new detail page successfully (HTTP 200). Nothing was
ingested by the probes. The HTTP 500 did not reproduce, so no collector defect
or retry-policy fix is claimed. Partial runs still cannot close jobs.

## Application email evidence and correction

All 15 currently actionable email postings have explicit application/CV-sending
instructions in their stored source descriptions; generic contact addresses were
not promoted. This audit inspected stored source text, not a new live fetch of
all 15 original postings. Thirteen are from HelloJob, one from SmartJob and one
from ADA, covering 12 normalized employer names.

Two genuine subject instructions were missed: “mövzu hissəsində” in Ateshgah's
insurance posting and “mövzu yerində” in Ballı Bisi's cashier posting. Extractor
version 4 recognizes these and other explicit subject-field variants. It still
does not infer a subject merely from a quoted role or a topic discussed nearby.

The corrected subject passes into the candidate's review draft. The optional
repair is dry-run by default:

```sh
docker exec aise-api node dist/scripts/backfill-job-facts.js --subjects-only
docker exec aise-api node dist/scripts/backfill-job-facts.js --subjects-only --apply
```

It only adds missing explicit subjects to existing email evidence, preserves
references and existing subjects, requires the same extracted recipient, and
uses a conditional update against the source text and evidence read. Concurrent
changes are skipped. It never changes freshness, lifecycle, descriptions,
allowances, application approvals or saved application snapshots.

One Signaltake posting additionally requires a Google Doc with five example
comments and links. CV and letter alone do not satisfy that posting. The full
instructions remain in the vacancy description; no task answers or applications
were generated or sent by this audit. Two other postings contain less explicit
quoted-role wording; no mandatory subject was inferred from it.

## Verification and remaining pilot work

- API unit suite: 96 suites, 1,584 tests passed.
- Regression coverage: subject-field variants, non-subject quoted text,
  extraction into the review draft, dry-run, repeatability, evidence preservation
  and concurrent-write refusal.
- Production release requires exact-commit CI, image provenance and a fresh
  off-host backup with a successful restore before deployment.
- Real candidate checkout through the current frontend in sandbox remains
  unproven. API/payment lifecycle checks from earlier handoffs are separate.
- No real Lever submission or acceptance has been observed. Autonomous mode
  remains off; a candidate-approved assisted test is still needed.
- No model evaluation, account deletion, live charge or outbound application
  was performed in this batch.

Private raw measurements are under `~/aise-preview/resume-2026-10-12/` on the
founder's Mac. They are excluded from Git.
