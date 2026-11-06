# Recommendation relevance and motivation preparation — 24 October 2026

## Problem and behavior

An aggregate score could clear the recommendation threshold despite a known occupation mismatch. The embedding API and rules scorer now share an occupation admission check: exact, adjacent and same-family work stays eligible; a known zero relationship is rejected. Explicit recognized target occupations take precedence over unrelated historical roles. Unknown or broad titles remain unknown, rather than receiving an invented incompatibility. Business Analyst aliases are recognized in Azerbaijani, English and Russian. The concept extractor distinguishes data cleaning from facility work, including mixed sentences where both occur. Related analytical/audit/finance/risk roles and SQL database work retain partial career paths; normal skill, qualification and seniority checks still apply. Cleaning work is not globally excluded: candidates targeting it remain eligible.

The scorer emits `breakdown.filters.role_relevant`. The API applies it before inserting matches/consuming allowance, displaying recommendations, creating notifications and sending delayed digests. Existing applied history remains visible. Revalidated non-applied mismatches no longer consume daily/weekly slots; profile scoring refreshes those rejected records before allocating the best eligible new matches. Notification records are retained for audit rather than deleted. Legacy rules results with zero role fit are conservatively suppressed; legacy embedding matches require revalidation.

Motivation preparation offers several editable alternatives per topic, one visible at a time, with source text and practical tips for role interest, employer interest, evidence and contribution. Missing requirements and untranslated source facts receive guidance. English source prose is not offered as a ready-made Azerbaijani answer. Browsing alternatives never changes answers; adoption/replacement stays explicit. Previous-letter answers are available on request and no longer silently inserted into a different vacancy. Saved answers on an existing document remain intact.

No external model calls, employer applications or notification sends were performed for this work. No profile or attachment content was committed. These are deterministic suggestions, not evidence of live-model persuasive quality or improved hiring outcomes.

## Validation

- API full run: 132 suites / 2,041 tests passed. Subsequent matching regression run: 66 tests passed, including old-mismatch revalidation before filling a newly freed slot in the same pass.
- Web full run: 97 suites / 618 tests passed; final document/proposal regressions: 40 tests passed.
- API build, web type check, proposal component ESLint, diff whitespace checks.
- Python rules selftests, real cached-model embedding API wrapper rejection, rules cache selftests, golden scorer checks (48/48).
- Development v2 rules benchmark: strong/partial scores and NDCG@5 (0.974) unchanged versus main; poor-pair median 0.103 → 0.000. The existing one C5 poor/email-floor failure remains in both baseline and this branch. This benchmark uses its existing `--gate none`; it is not a claim that every recommendation is now correct.

## Production-data preview before merge

A read-only preview examined 54 non-applied existing matches across the eight completed profiles. The refined rule rejects five occupation mismatches (three cleaning posts, one teaching post and one marketing post). Related audit, financial-risk and SQL database roles remain eligible for their normal scoring and requirement checks. No candidate records or source text were committed; the preview made no production changes.

This preview caught an overly narrow initial boundary before merging; its fixes include the data-cleaning ambiguity and tests for related analytical careers. Cached-model embedding, rules, cache and golden checks were rerun successfully after the refinement; the v2 development benchmark results above are unchanged.

## Release requirements

Build and release **matching-service as well as API and web**; reusing the previous matching image would omit the main relevance fix. Keep the existing backup/restore, exact-image and rollback checks. No schema, price, quota-limit or sending-consent changes are needed.

After deploying and verifying the new scorer, run the existing throttled silent revalidation (first inspect its dry-run output):

```sh
docker exec -w /repo/apps/api aise-api node dist/scripts/rescore-profiles.js --rollout role-relevance-20261024
# Recompute existing scores without announcing the rollout:
docker exec -w /repo/apps/api aise-api node dist/scripts/rescore-profiles.js --apply --rollout role-relevance-20261024 --silent --all
```

Do not claim historical alerts are corrected before revalidation completes. The rollout updates existing matches and creates eligible new ones under ordinary allowances; it does not delete job postings or reset subscriptions. Keep PRs #107/#108/#111/#112 separate from this change.
