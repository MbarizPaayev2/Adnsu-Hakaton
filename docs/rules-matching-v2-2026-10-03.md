# Rules matching v2: improvements, v2 evaluation, cache and journeys (3 October 2026)

Follows `docs/rules-matching-evaluation-2026-10-03.md`. Status: **local evaluation candidate; opt-in (`SCORER_MODE=rules`); production default and the e-mail thresholds (0.35 store / 0.50 e-mail) are unchanged.**
Nothing was merged, deployed, rescored in production or sent. Scorer `rules-v1.2`, lexicon `2026-10-03.4`.

## 1. What changed in the scorer (answers to the four documented problems)

| Problem | Change |
|---|---|
| Customer support matched IT support | "support specialist" no longer belongs to customer support; technical support / helpdesk / "texniki dəstək" are IT support; they are adjacent at most (weak, 0.3). Telesales and cashier became their own occupations (cashier no longer collides with bank teller). |
| manager / menecer seniority | A managerial title ("manager", "menecer", "менеджер", "rəhbəri", "head of") is at least mid-level even when no experience band is stated; a junior is then one level short. Explicit bands and title markers still win. |
| Subject-specific occupations | `SUBJECTS` in the lexicon: a teacher's role credit depends on the subject (same 1.0, neighbouring 0.55, different 0.3; unknown subject on either side neutral). |
| Adjacent occupations got nothing | Explicit symmetric `ADJACENT` table across occupation families (values are hypotheses; weak adjacency 0.3 ranks above unrelated but is not enough to be stored on its own). Broad occupations ("engineer", "director") earn no family credit. |
| Also found | Preferred qualifications ("ACCA üstünlük sayılır") were being penalised as if mandatory: now mandatory ×0.5 (hypothesis), preferred reported and never penalised. A candidate with only a headline (no target roles or past titles; common) had an unknown role and so never matched: the headline now stands in for the target role. Equal scores are broken by the newer posting, then id (matching service; unit-tested). |

Unchanged guarantees (tested in `rules_selftest.py`, 18 behaviour checks): unknown stays unknown (null component, `confidence`, low-confidence cap under the storage threshold), repeated keywords cannot raise a score,
explanations list components, evidence and gaps, a stated mandatory restriction is not turned into a preference, an incomplete profile never reaches the e-mail floor. A fit score is a suitability index, **not** a hiring probability.
The API still stores nothing for an incomplete pass, spends no quota on it, and gives a free user the best three eligible results (verified below).

## 2. Evaluation set v2 and integrity

`apps/matching-service/eval/v2/`: 50 synthetic postings (az/ru/en) and 11 synthetic personas (7 development, 4 sealed), labels written by the engineer. **This is not independent human review and no native speaker has reviewed anything.**
The set was committed (`a7a6d18`) before any scorer was run on it. The four sealed personas were scored only after the scorer was frozen (`e7fcf58`) and nothing was changed afterwards; they are consumed now: any further change makes them a development set.
The earlier v1 set and its held-out results (`docs/rules-matching-evaluation-2026-10-03.md`) stay as historical evidence of the *previous* scorer; they were inspected before these changes, and v1 was only used here as a development regression (it still passes every criterion on dev).
The v1 held-out personas were scored once more by the threshold sweep (section 5) with the current scorer; that is a second look, not independent validation, and no change was made in response.

Known label disputes (kept as written, counted against the scorer): `Q4_sales_junior / v37 Aptek satıcısı` (a pharmacy seller for a sales consultant is arguably partial, scored 0.84); `S3_telesales_ru / v29 Satış məsləhətçisi (elektronika)` (arguably partial, scored 0.51). Both are my labelling inconsistencies; they are the only poor pairs at the e-mail floor.

## 3. Quality results (same C1–C10 bounds as v1; raw output `docs/evidence/rules-v2-eval-2026-10-03.txt`)

The embedding scorer was **not** tuned on v2. The rules scorer was tuned on v2 *development* only, so the fair comparison is the sealed split.

| | embedding dev | rules dev | embedding **sealed** | rules **sealed** |
|---|---|---|---|---|
| C1 strong above poor | 1.000 ✓ | 1.000 ✓ | 1.000 ✓ | 1.000 ✓ |
| C2 strong above partial | 0.950 ✓ | 0.900 ✓ | 1.000 ✓ | 0.923 ✓ |
| C3 partial above poor | 0.917 ✓ | 0.986 ✓ | 0.888 ✓ | 0.989 ✓ |
| C4 hard stored | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ |
| C5 poor/hard at the floor | **2 ✗** | **1 ✗** (v37, disputed) | **1 ✗** | **1 ✗** (v29, disputed) |
| C6 strong reach the floor | 1.000 ✓ | 1.000 ✓ | 1.000 ✓ | 0.857 ✓ |
| C7 median gap | 0.380 ✓ | 0.699 ✓ | 0.419 ✓ | 0.705 ✓ |
| C8 incomplete profile at the floor | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ |
| C10 NDCG@5 | 0.924 ✓ | 0.974 ✓ | 0.896 ✓ | 0.976 ✓ |

Relevant = strong + partial:

| | stored (≥ 0.35) | precision | strong kept | at the floor (≥ 0.50) | precision | strong kept |
|---|---|---|---|---|---|---|
| embedding dev | 51 | 0.37 | 10/10 | 14 | 0.86 | 10/10 |
| rules dev | 26 | 0.81 | 10/10 | 19 | 0.95 | 10/10 |
| embedding sealed | 34 | 0.38 | 7/7 | 8 | 0.88 | 7/7 |
| rules sealed | 23 | 0.70 | 7/7 | 10 | 0.90 | 6/7 |

Classification errors seen (sealed, reported, not fixed): the lexicon has no "maliyyə nəzarətçisi" (financial controller), so that title was unknown for a candidate whose target role it is (strong pair scored 0.41, below the floor: the 6/7); both disputed pairs above. Development: adjacency credit
initially stored weakly related pairs (customer support ↔ sales consultant at 0.37–0.43); the table was lowered to 0.3 for weak pairs, a dev-informed choice. With 4 sealed personas and 7 strong pairs these numbers are indications, not proof.

## 4. Real journeys, rules mode (local API, queue, database, real rules scorer in a container, merged UI; synthetic candidate and CV)

Native arm64 laptop, scorer container 4 CPUs / 1 GiB. **Not production performance.** Candidate: headline "Mühasib / Accountant", five skills, CV fixture. Inventory 1,425 eligible postings, 25 per chunk.

| Measure | Cold cache (container restarted) | Warm cache |
|---|---|---|
| Onboarding complete → 3 persisted matches | **68.2 s** | **1.0 s** (poll resolution) |
| Matches page: navigation → first matched title visible (Next dev server) | 1.5 s | 0.45 s |
| Scorer chunks (57) | span 66.4 s; per chunk median 0.95 s, p95 2.3 s, max 3.4 s | whole pass 0.28 s; per chunk ≤ 15 ms |
| Retries / failures / timeouts | 0 / 0 / 0 | 0 / 0 / 0 |
| Real scores persisted | 0.788, 0.758, 0.744 | same |
| All 7 browser checks (catalogue, filters, detail, register→onboarding, matches, e-mail preview/approval to the local sink) | pass | pass |

- **Free-plan selection:** the whole inventory was re-scored (1,425/1,425); the persisted three equal the top-3 scores. Scores tie often in this mode (4 postings tie at or above the third-best score), so ties are now broken deterministically in favour of the newer posting.
- **Simultaneous requests, one profile:** six simultaneous `runMatchingForProfile` calls caused **one** full scorer pass (1,425 lookups = 1.00 pass), all fulfilled, 3 matches stored (allowance 3); the next request started its own pass. (`test/rules-concurrency-probe.ts`; unit-tested single flight.) Queue jobs for the same profile are still processed one after another, not collapsed.
- **Partial passes:** unit tests (68 matching specs) and the real-scorer e2e outage/malformed-response cases (run against the rules container: 5/5) show no partial matches stored and no quota spent.
- An earlier cold attempt stored nothing because the candidate's headline did not count as a role (a scorer gap, fixed as described in section 1, not a pass).
- Not measured: real browsers on a production build, production hardware, concurrent users, a first-time Next.js compile cost.

## 5. Threshold-calibration evidence (separate; **no threshold was changed**)
`docs/evidence/rules-threshold-sweep-2026-10-03.txt` (`eval/threshold_sweep.py`). Rules scores are on a different scale (strong median ≈ 0.8) from the embedding score the 0.35/0.50 values were chosen for. On v1 dev+held-out (not independent, see section 2) pairs at 0.50 or above were all relevant (28 of 28); at 0.35, 36 of 39 (precision 0.92).
On v2 development: 0.35 → 26 stored, precision 0.81; 0.45–0.50 → 19 stored, precision 0.95; strong pairs are kept up to 0.70. This suggests the storage threshold could be raised for rules mode and the e-mail floor kept, but the sample is small, engineer-labelled and partly tuned-on: **a calibration needs a larger, independently labelled set and an agreed rule for the cost of a false e-mail**. Until then rules mode would reuse the existing values, which is the safer-to-explain but untested choice.

## 6. Cold-cost investigation and cache design

Measured per posting (host M4, single thread): parse with `pipeline.parse_*` 28 ms, of which about half was `concept_count`, which the rules scorer does not use → now skipped (`with_counts=False`, default unchanged for the embedding scorer): parse 16.7 ms. Rules feature extraction 14 ms (regex dictionaries; an attempt to batch requirement sentences gave no measurable gain and was dropped). Scoring one profile against all postings with features cached: about 10 ms per 1,425. Total cold ≈ 31 ms per posting (was ≈ 42).

Cache (`main.py`, rules mode):
- **Key** = SHA-256 of scorer version + lexicon version + the posting payload exactly as received. Changed content → new key; a scorer or lexicon change → every entry misses (`rules_cache_selftest.py`).
- **Invalidation of closed/changed postings:** a closed, hidden, duplicate or expired posting is no longer sent by the API (actionable filter), so its entry is never read; it leaves by TTL (6 h, `SCORER_RULES_CACHE_TTL_S`) or the size bound (20,000, `SCORER_RULES_CACHE_MAX`), LRU. Entries are only ever posting-derived; **no candidate data enters the cache** (tested by checking the cached object for a candidate's name/e-mail and by comparing cached and fresh results for alternating candidates).
- **Visibility:** token-protected `GET /cache-stats` (mode, version, entries, hits, misses, evictions, expired; no content).
- **Memory:** 40.8 MiB at start; 69.8 MiB with 1,425 entries; 166.7 MiB with 6,425 entries (≈ 20 KB per entry; 20,000 entries ≈ 0.4 GB, extrapolated).
- **Capacity test (`docs/evidence/rules-http-capacity-2026-10-03.txt`):** the **SYNTHETIC** 5,000-posting set (mutated copies of real postings; speed, not relevance): cold 240 s (per-25 request median 0.88 s, p95 2.3 s), warm 2.1 s including client overhead. Real 1,425: cold 67.7 s, warm 2.0 s.
- **Not done, deliberately:** a persistent feature store or ingestion-time precomputation (would need a migration and API wiring). A restart or TTL expiry costs about one minute per 1,400 postings; measure again before deciding. No migration was needed or made.

## 7. Tests run (local)
- Passed: `rules_selftest.py` (18 checks), `rules_cache_selftest.py` (6), `selftest.py` (embedding path), run in the arm64 image against the working tree; `eval/run_eval.py` v1 dev (all criteria), v2 dev/sealed as above.
- Passed: API unit suite and `nest build` (see the handoff for counts), matching specs 68; web Vitest 175 and `tsc` after the design merge.
- Passed (isolated `aise_phase2_test`, sequential): e2e `jobs-matching` 4, `rescore-queue` 4, `silent-rescore` 4, `jobs-matching-real-scorer` 5 (against the rules scorer).
- Passed: the authenticated browser journey, cold and warm (7 checks each) on the integrated UI.
- Not run: the full e2e sequence, a production Next.js build with real public environment values, a persistent-cache restart test, load with many simultaneous candidates.
- CI: `ci.yml` now also runs `rules_selftest.py`, `rules_cache_selftest.py`, the v1 dev gate and a report-only v2 run (v2 is not gated because of the disputed label).

## 8. Recommendation
Rules mode is **not ready for a production switch**, and I do not recommend one yet. It **is** ready for a controlled, opt-in local/staging canary in shadow mode (score both, store only the existing scorer's matches, compare). Reasons it is a credible MVP baseline: ≈ 1 minute cold and ≈ 1 second warm
on a small container versus 15 minutes cold for the embedding scorer, about half the unsuitable pairs stored, explainable components, no model. Reasons not yet: no native-speaker lexicon review, engineer-written labels, a tiny sealed set (4 personas), a lexicon that missed one common title, thresholds uncalibrated, tied scores common, in-memory cache only.

Remaining gates before a controlled switch: (1) native-speaker review of the lexicon and of the v2 labels, by someone other than the scorer's author; (2) a larger independently labelled set scored once; (3) threshold calibration for the rules score distribution and an agreed false-e-mail cost; (4) shadow comparison on staging inventory; (5) decide persistent features vs. in-memory cache; (6) the existing release gates in `docs/source-integration-and-census-2026-10-02.md` (PR #12 gates, backup, alerts, rollback rehearsal).

## 9. Reproduce
```bash
cd apps/matching-service
python rules_selftest.py && python rules_cache_selftest.py   # the second needs the service dependencies (fastapi)
python eval/run_eval.py --set v2 --split dev --scorer rules=rules:.
python eval/threshold_sweep.py --run v2 dev
SCORER_MODE=rules MATCHING_SERVICE_TOKEN=... uvicorn main:app
# apps/api: test/census-browser.ts (REAL_SCORER=1), test/scorer-latency-probe.ts (fullpass|verify), test/rules-concurrency-probe.ts
```
