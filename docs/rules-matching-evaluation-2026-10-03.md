# Rules-based matching as the MVP baseline: evaluation (3 October 2026)

Status: **evaluation only.** Nothing is switched, deployed or removed. The embedding scorer stays the default; the rules mode is opt-in (`SCORER_MODE=rules`)
and not used by any queue. Email thresholds (`MATCH_SCORE_THRESHOLD` 0.35, `MATCH_EMAIL_MIN_SCORE` 0.50) are unchanged and were **not** recalibrated for the new
score distribution (see "What must happen before any switch").

## 1. What was built

`apps/matching-service/rules_scorer.py` (+ `rules_lexicon.py`): a deterministic scorer with no embedding model, no LLM and no network.
It reuses the existing normalisation in `pipeline.py` (`parse_job`/`parse_vacancy`/`parse_persona`, the az/en/ru/tr `CONCEPTS` dictionary, locations, experience
bands, education ranks, language detection, salary/FX) and adds:

| Capability | How |
|---|---|
| AZ/RU/EN occupation and skill synonyms | 47 occupations in 20 families and extra skill concepts in `rules_lexicon.py`; Azerbaijani letters folded, inflected stems matched. **A seed, not a reviewed lexicon** (needs native-speaker review). |
| Required vs preferred criteria | Each posting sentence is classified (requirements section / "tələb olunur", "must" → required; "üstünlük", "nice to have", "будет плюсом" → preferred; otherwise mentioned). |
| Seniority | Posting level (title markers, experience band, seniority label) vs candidate level from years. |
| Candidate preferences | Cities, remote, salary floor, languages, education: same rules as the existing scorer; unknown on either side is neutral. |
| Explicit qualifications | ACCA/CPA/CFA/PMP/IELTS, driving licence, medical/bar licence; regulated occupations. |
| Unknown values preserved | Each component is `null` when its data is missing; `confidence` is reported; a low-confidence score is discounted and capped below the storage threshold. |
| Explanations | `components` (name, value, weight, known, why), `notes`, `matched_concepts`, `gaps` in the existing breakdown (additive keys; contract unchanged, `semantic` is 0.0). |
| No keyword stuffing | Skills are compared as sets of concepts, never counted (tested: 40× repeated posting text and 30× repeated profile skills change nothing). |

Score = confidence-weighted blend of role 0.45, required skills 0.30, preferred skills 0.10, seniority 0.15, discounted by (0.5 + 0.5 × confidence) and multiplied by the
existing mismatch multipliers (location 0.6, salary 0.75, experience gap 0.7/0.55/0.4, education 0.8/0.65, language ≥ 0.7, regulated occupation 0.4, missing explicit
qualification 0.8). **The four weights are hypotheses**: they were written down before the first run and have not been changed since.

Quotas, actionable-job filtering, duplicate exclusion, the `/score` and `/score-profile` request/response contracts and the UI are untouched: the mode only changes
how a score is computed inside the scorer service.

## 2. Method and integrity

- Same fixtures, same labels, same criteria C1–C10 as `docs/matching-evaluation.md` (`apps/matching-service/eval/`, unchanged). `run_eval.py` only gained a loader for `rules:<dir>`.
- Development used only the 7 development personas. After the first development run the following were added, each visible in git: three vocabulary entries seen
  missing in development postings (credit-risk phrases, locksmith/plumber trades), and two structural rules (broad occupations such as "engineer" count only when nothing
  more specific is found; when both sides have a recognised occupation the lexicon decides, not the generic concept overlap). No weight was touched.
- **Held-out personas were evaluated once, after the weights and rules were frozen, and nothing was changed afterwards.** The failing held-out pairs were diagnosed (below)
  but deliberately not fixed: a fix made after seeing them would make the held-out set a development set. The held-out set is tiny (3 personas, 6 strong pairs): treat its
  numbers as indications, not proof. Both scorers were developed against the same development personas; the embedding scorer's weights were also tuned on them.
- Labels: `strong`/`partial`/`hard`, every other pair is `poor`. The `poor` set is not exhaustive (some of those pairs may be acceptable), which affects both scorers equally.
- Reviewer notes on real postings (section 6) are my own informal reading, not an independent review.

## 3. Ranking quality (evaluation set: 52 postings, 7 development + 3 held-out personas)

Criteria C1–C10 and bounds from `eval/run_eval.py`, unchanged. ✓ pass, ✗ fail. Raw output: `docs/evidence/rules-vs-embedding-eval-2026-10-03.txt`.

| Criterion (bound dev / held-out) | embedding dev | rules dev | embedding held-out | rules held-out |
|---|---|---|---|---|
| C1 strong above poor (0.95 / 0.90) | 0.995 ✓ | 1.000 ✓ | 1.000 ✓ | 0.996 ✓ |
| C2 strong above partial (0.80 / 0.75) | 0.889 ✓ | 0.867 ✓ | 0.857 ✓ | 1.000 ✓ |
| C3 partial above poor (0.80 / 0.75) | 0.883 ✓ | 0.964 ✓ | 0.842 ✓ | **0.694 ✗** |
| C4 hard mismatches stored (0) | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ |
| C5 poor/hard pairs at the 0.50 floor (0) | 0 ✓ | 0 ✓ | **2 ✗** | **1 ✗** |
| C6 strong pairs reaching the floor (0.70 / 0.60) | 0.750 ✓ | 1.000 ✓ | 0.833 ✓ | 1.000 ✓ |
| C7 median(strong) − median(poor) (0.20) | 0.420 ✓ | 0.744 ✓ | 0.311 ✓ | 0.704 ✓ |
| C8 incomplete profile at the floor (0) | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ |
| C9 location-bug twin (≤ 0.05) | 0.000 ✓ | 0.000 ✓ | n/a | n/a |
| C10 mean NDCG@5 (0.85) | 0.861 ✓ | 0.930 ✓ | 0.867 ✓ | 0.913 ✓ |

Held-out failures of the rules mode (diagnosed, not fixed, see section 2):
- **C5**: a customer-support persona matched "IT Support Specialist" (0.69). The seed lexicon lists "support specialist" under customer support, so the title counts as the same occupation. A lexicon ambiguity that review should resolve.
- **C3**: partial pairs are *adjacent* occupations (sales consultant for a call-centre profile, office manager for a call-centre profile, pharmacy seller for a nurse). The rules mode gives no credit across occupation families, so these score 0.0–0.2. The embedding scorer gives them partial credit. An explicit adjacency table would be a new hypothesis to validate on fresh held-out data.

## 4. Unsuitable recommendations (same labels; relevant = strong + partial)

| Scorer / split / threshold | stored | relevant | unsuitable | precision | strong recall |
|---|---|---|---|---|---|
| embedding, dev, 0.35 | 69 | 24 | 45 | 0.35 | 11/12 |
| rules, dev, 0.35 | 24 | 24 | 0 | 1.00 | 12/12 |
| embedding, held-out, 0.35 | 36 | 10 | 26 | 0.28 | 6/6 |
| rules, held-out, 0.35 | 9 | 8 | 1 | 0.89 | 6/6 |
| embedding, dev, 0.50 | 15 | 15 | 0 | 1.00 | 9/12 |
| rules, dev, 0.50 | 21 | 21 | 0 | 1.00 | 12/12 |
| embedding, held-out, 0.50 | 9 | 7 | 2 | 0.78 | 5/6 |
| rules, held-out, 0.50 | 8 | 7 | 1 | 0.88 | 6/6 |

At the storage threshold the embedding scorer stores roughly three to four unsuitable pairs per relevant one; the rules mode stores almost none. Because the quota is spent on stored
matches, this matters for free users. The rules scores are on a different scale (strong median 0.82 vs 0.63), so the **same thresholds do not mean the same thing**: the 0.50 floor
is far more permissive for the rules mode in relative terms and needs its own calibration before any e-mail depends on it.

## 5. Missing-data behaviour (`eval/missing_data.py`; 9 labelled personas × 52 postings)

One kind of information is blanked at a time; "unsuitable stored" counts poor/hard pairs ≥ 0.35 over all 9 personas. Raw output: `docs/evidence/rules-vs-embedding-missing-data-2026-10-03.txt`.

| Variant | embedding NDCG@5 / unsuitable stored / strong stored | rules NDCG@5 / unsuitable stored / strong stored |
|---|---|---|
| baseline | 0.863 / 71 / 0.94 | 0.924 / 1 / 1.00 |
| no preferred cities | 0.844 / 84 / 0.94 | 0.929 / 3 / 1.00 |
| no languages | 0.892 / 73 / 1.00 | 0.924 / 1 / 1.00 |
| experience unknown (0 years) | 0.622 / 24 / 0.67 | 0.866 / 1 / 1.00 |
| half of the skills missing | 0.871 / 55 / 0.94 | 0.905 / 1 / 1.00 |
| no target titles | 0.841 / 7 / 0.72 | 0.899 / 1 / 0.89 |
| posting without location | 0.844 / 84 / 0.94 | 0.929 / 3 / 1.00 |
| posting without requirements section | 0.848 / 75 / 0.89 | 0.891 / 1 / 1.00 |

The embedding scorer treats "experience unknown" as "0 years" and penalises it (NDCG 0.86 → 0.62, strong stored 0.94 → 0.67). The rules mode keeps unknown as unknown (0.92 → 0.87). Both
degrade gracefully on missing salary, languages and half the skills; with no target titles at all the rules mode loses some strong pairs (0.89), as it relies on the role signal.

## 6. Real inventory (1,425 current eligible census postings, 10 evaluation personas)

There are no relevance labels for real postings, so this section reports **agreement and counts**, plus an informal reading of the top five. Data: `docs/evidence/rules-vs-embedding-inventory-2026-10-03.json`.

| Persona | stored (≥0.35) embedding / rules | at floor (≥0.50) embedding / rules | Spearman | top-10 overlap |
|---|---|---|---|---|
| D1 software engineer | 154 / 25 | 16 / 19 | 0.30 | 0.4 |
| D2 accountant (az) | 718 / 34 | 144 / 21 | 0.43 | 0.7 |
| D3 sales (az) | 879 / 215 | 312 / 158 | 0.57 | 0.6 |
| D4 incomplete profile | 0 / 0 | 0 / 0 | – | – |
| D5 junior marketing | 294 / 52 | 35 / 45 | 0.22 | 0.5 |
| D6 risk, bank | 266 / 33 | 15 / 14 | 0.26 | 0.7 |
| D7 teacher | 419 / 43 | 47 / 28 | 0.27 | 0.6 |
| H1 call centre (ru/az) | 780 / 63 | 218 / 33 | 0.34 | 0.2 |
| H2 nurse | 404 / 4 | 69 / 3 | 0.11 | 0.3 |
| H3 civil engineer | 386 / 61 | 38 / 15 | 0.34 | 0.4 |

On real Azerbaijani postings the embedding scorer stores about half of the inventory for an accountant (718 of 1,425) and puts 144 above the e-mail floor; for the nurse it lists two labourer
postings ("Fəhlə", ≥ 0.61) in the top five. The rules mode returns 34 and 3 respectively, and its nurse list is nurse postings first. The two scorers agree only loosely (mean Spearman ≈ 0.31, mean
top-10 overlap ≈ 0.49).

Informal reading of the top-5 lists (one reviewer, not independent): rules mode is clearly relevant in roughly 41 of 45 slots, embedding in roughly 36 of 45. Where the rules mode is weaker: a
junior marketing graduate gets "Marketing Manager" first (the title says manager but no level marker is recognised), and a maths teacher gets other teaching postings ranked level with maths
(the lexicon has no subject specialisation); in the software persona it surfaces trainee and 1C roles above two clearly better developer postings. The embedding scorer is weaker on generic roles
(service engineer for a software profile, information-centre postings for a call-centre profile).

## 7. Latency

Two different machines and settings, so read each row on its own terms. **None of this is production performance.**

| Measurement | Embedding scorer (native arm64 container, 4 CPUs, 3 GiB) | Rules mode (same container image, `SCORER_MODE=rules`, 4 CPUs, 1 GiB) |
|---|---|---|
| Full real inventory, 1,425 postings, 25 per request, first pass | **15.3 min** (57 requests, median 13.7 s, p95 31.0 s) | **68.0 s** (median 877 ms, p95 2.8 s) |
| Same, second pass (scorer-side cache warm) | 45.7 s (median 0.63 s per request; remaining cost is parsing and persona embedding) | **0.28 s** (median 5 ms per request) |
| Memory in use | 1.0–2.9 GiB | ≈ 70 MiB |
| Model needed | yes (≈ 460 MB weights, first request 7.5 s) | no |

In-process rules benchmark (`eval/bench_rules_latency.py`, host Apple M4, single thread, other work running; `docs/evidence/rules-latency-host-2026-10-03.txt`):

| | real inventory (1,425) | **SYNTHETIC** 5,000 postings (mutated copies of the real ones; measures speed, not relevance) |
|---|---|---|
| parse postings (existing `pipeline.parse_*`, shared by both scorers) | 28 ms each | 29 ms each |
| extract rules features once per posting | 13.7 ms each | 14.6 ms each |
| score one profile against everything, features cached | 10.4 ms | 38.7 ms |
| cold full pass for one profile (parse + features + score) | 59 s | 220 s |
| peak memory | 102 MB | 179 MB |

Embedding at 5,000 postings is **extrapolated, not measured**: 0.64 s per posting cold gives ≈ 54 minutes for a full pass on 4 CPUs; with a warm cache the pass is dominated by parsing (≈ 45 s per 1,425, so ≈ 2.7 min for 5,000).
The embedding cache default was raised to 8,000 postings so that a 5,000-posting inventory fits (the previous 3,000 would have evicted every entry before reuse in a sequential pass).
For the rules mode the cost is almost entirely the one-off parsing, which is paid per distinct posting and can be moved to ingestion; once cached, scoring a profile against 5,000 postings is tens of milliseconds.

## 8. Verdict against MVP requirements

The requirements below are **proposed** (none were stated); the founder should confirm or change them.

| Proposed MVP requirement | Embedding scorer | Rules mode |
|---|---|---|
| A new candidate sees matches within about a minute of onboarding on one small instance, with 1,400–5,000 postings | ✗ cold 15 min at 1,425, ≈ 54 min at 5,000 (≈ 1 min only with a fully warm cache, which a fresh deploy or an evicted cache does not have) | ✓ ≈ 1 min cold at 1,425 and under 4 min at 5,000 in one thread with no precompute; seconds with features cached or computed at ingest |
| Few unsuitable recommendations (nothing unsuitable at the e-mail floor) | ✗ held-out C5 fails; 3–4 unsuitable per relevant pair stored | ◐ dev passes; held-out 1 pair at the floor (a fixable lexicon ambiguity); 0–1 unsuitable stored per persona |
| Unknown data is not punished | ✗ unknown experience is treated as 0 years | ✓ unknown is preserved and reported |
| Explainable, no stuffing, no external model | ✗ opaque semantic score | ✓ components and reasons; repetition tested not to matter |
| Ranking quality on held-out data | ✓ C1–C4, C6–C7, C10 | ◐ passes all but C3 (adjacent occupations) and C5 |

**Conclusion.** Neither approach is proven on a large, independently labelled set. On the evidence here the rules mode meets the speed requirement and most of the quality requirement, and the embedding
scorer, as it is deployed, does not meet the speed requirement on a small CPU instance and is too permissive on real Azerbaijani postings. The rules mode is the better **MVP baseline candidate**, with two
known weaknesses to address: no credit for adjacent occupations, and a seed lexicon that has not been reviewed. A hybrid (rules mode as the gate and ranking, the embedding as an optional secondary signal for
adjacent roles) is a sensible next experiment, not a result.

### What must happen before any switch (none of this was done)
1. Native-speaker review of `rules_lexicon.py` (Azerbaijani, Russian, English), including the "support" ambiguity and level markers (manager/menecer).
2. New held-out personas and labels (at least 15–20 personas) written before looking at any scorer output; re-run both scorers once; no tuning against them.
3. Ablations of the four weights, an adjacency table and subject specialisation as explicit, separately validated hypotheses.
4. Calibrate the storage threshold and the e-mail floor for the rules score distribution (strong median 0.82), with the same rule set as in `docs/matching-evaluation.md`; do not reuse 0.35/0.50.
5. Decide where parsing runs (ingestion-time features) and a persistent cache; run a real-browser journey in rules mode and an API-contract test against the web UI.
6. Keep the embedding scorer deployable until the above is done; both modes ship in the same image and `SCORER_MODE` selects between them (default `embedding`).

## 9. Reproduce

```bash
cd apps/matching-service
python rules_selftest.py
python eval/run_eval.py --split all --scorer embedding=. --scorer rules=rules:.      # needs the pinned model cached
python eval/missing_data.py --scorer embedding=. --scorer rules=rules:.
python eval/bench_rules_latency.py --inventory inventory.json --synthetic 5000        # inventory.json from apps/api/test/scorer-latency-probe.ts dumpall
python eval/inventory_compare.py --inventory inventory.json --scorer-url http://127.0.0.1:8100 --token-file <token file> --out out.json
SCORER_MODE=rules MATCHING_SERVICE_TOKEN=... uvicorn main:app    # rules mode over HTTP, same endpoints
```
