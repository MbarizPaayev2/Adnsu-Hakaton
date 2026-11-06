# Match quality: diagnosis, evaluation and changes (30 September 2026)

This records why match scores on aisehr.com clustered at 35–48%, how the scorer
was evaluated before anything was tuned, what changed, and what is *not* proven.

## 1. What the number means

A match score is a **suitability index between 0 and 1**, shown in the app as
"NN% Uyğunluq" and used for two gates. It is **not a probability of being hired
or shortlisted** and is not calibrated against any outcome; no outcome data exists yet.
It must not be described to users as a chance of success.

Units through the system (traced in code, all consistent):

| Step | Where | Unit |
|---|---|---|
| `score_job` | `apps/matching-service/pipeline.py` | 0–100, `base × filter multiplier × 100` |
| `/score`, `/score-profile` | `apps/matching-service/main.py` | divided by 100 → 0–1 (4 d.p.) |
| API validation | `job-matching.service.ts` `validResults` | rejects anything outside 0–1 |
| Storage | `Match.score` (Float) | 0–1; stored only when `>= MATCH_SCORE_THRESHOLD` (0.35) |
| Email | `notifications.service.ts` | `>= MATCH_EMAIL_MIN_SCORE` (0.50), ≤ 3 emails/day |
| UI | `dashboard/matches/page.tsx` | `Math.round(score × 100)` % |

There is no unit mismatch. The clustering is a property of the scorer itself.

## 2. Diagnosis of the 35–48% cluster (read-only, production `75754ea`)

1. **Production runs a scorer that is 4 weeks old.** The `aise-matching-service`
   container (image `4fcc23c2`, created 29 Sep 17:50 from a 4-week-old build)
   holds `pipeline.py` and `main.py` byte-identical to the 30 August *Initial
   commit* (SHA-256 `c8c01768…` / `4d5e0ab9…`). The release deployed on 29 Sep
   deliberately did not rebuild that image (disk), so the later scoring fixes
   (filter softening, top-k skill pooling, `/score-profile`, model pin) never
   reached production. The embedding model *is* the pinned revision
   `e8f8c211…` and the libraries match the lock, so this is a code gap, not a
   model gap. The old `main.py` also has no `/score-profile`, which the current
   API calls when a profile is onboarded (no calls in the last 48 h, because no
   one onboarded; a new signup would get no matches).
2. **Measured on production (aggregates only).** 213 matches, 3 users, min 0.293,
   median 0.370, **max 0.481**; none ≥ 0.50, so the 50% email floor suppresses every
   notification. Every stored match passes all five filters; the average
   components are semantic 0.42, role 0.47, skill 0.39, keyword 0.37. The old
   scorer also multiplies by 0.9 for every posting without a salary (95% of Glorri
   postings), so the ceiling for a good pair is about 0.9 × 0.55.
3. **A near-exact match does not clear the floor.** A "business analyst" profile's
   top matches are "Business Analyst" postings at 0.481. Reproduced locally
   (deployed scorer 48.9%, this change 59.4%; an unrelated accountant posting for the same profile still scores 38%, stored but never emailed).
4. **Ranking defects, real but smaller:** a "Frontend developer" profile's best
   match is a Java posting, above "React developer (middle)".
5. **Scorer defects found while evaluating** (each has a regression check in
   `eval_golden.py`; fixes in §5): generic soft skills counted as concept matches;
   Azerbaijani/Russian inflected stems never matched; `azerbai` matched every
   "Azerbaijani market" sentence as a language requirement; no role-level credit
   for an equivalent title; regulated occupations (doctor, nurse, lawyer) and
   far-senior postings barely discounted; a job whose location is actually an
   employment type ("Tam ştat", see `docs/data-quality-2026-09-30.md`) was charged the ×0.6
   outside-preferred-city penalty.
6. **Quota interaction (not changed here).** The free plan allows 3 new matches
   a month, consumed in arrival order. With a noisy 0.35 threshold the quota can be
   spent on weak matches before a good one arrives; fewer, better stored matches
   (fewer false positives, §4) helps, but quota-by-quality needs a product decision.

## 3. Evaluation set, criteria and method

Fixtures: `apps/matching-service/eval/` (all synthetic; no real candidate and no
copied posting). 52 postings in Azerbaijani and English (Glorri-shaped, realistic
length and labels, 95% without salary, employment-type-as-location twin, thin
postings), 10 profiles in 7 development + 3 held-out personas (English and
Azerbaijani wording, equivalent titles, an incomplete profile, hard mismatches,
two domains the concept dictionary does not cover). Personas are produced by the
production `buildPersonaFromProfile` adapter (spec fails on drift). Labels
(`strong`/`partial`/`hard`, else poor) were written before any scorer change.

Acceptance criteria are encoded in `eval/run_eval.py` and were fixed before
tuning (committed `012f2b4`; bounds unchanged since): ordering of strong > partial > poor
(C1–C3), hard mismatches never stored (C4), no poor/hard pair at the email floor
(C5), strong pairs reaching the floor (C6), strong/poor median gap (C7), an
incomplete profile never emailed (C8), the location-bug twin scoring the same
as its twin (C9), NDCG@5 (C10). Held-out bounds are 5 points laxer on C1–C3 and C6.

Process, stated plainly: fixtures were first too clean (`012f2b4`), were made
realistic from production statistics and extended with uncovered domains
*before* any scorer change (`378caf3`), and all numbers below use those. All tuning
used only the development personas. **Disclosure:** held-out results were viewed
twice during development, once for an intermediate candidate and once as the
final confirmation; the held-out personas did not guide any change.

Commands (from `apps/matching-service`, offline with the pinned model cached):

```bash
python eval/run_eval.py --split all --scorer deployed=git:9decf92 --scorer main=git:378caf3 --scorer candidate=.
python eval_golden.py && python selftest.py
```

## 4. Results

`deployed` = the 30 Aug scorer still in production; `main` = the repository
scorer before this change (what a rebuild of current `main` would run);
`candidate` = this change. ✓ pass, ✗ fail.

**Development split (7 personas)**

| Criterion | bound | deployed | main | candidate |
|---|---|---|---|---|
| C1 strong above poor | 0.95 | 0.87 ✗ | 0.90 ✗ | **0.99 ✓** |
| C2 strong above partial | 0.80 | 0.67 ✗ | 0.76 ✗ | **0.89 ✓** |
| C3 partial above poor | 0.80 | 0.86 ✓ | 0.80 ✓ | **0.88 ✓** |
| C4 hard mismatches stored (count) | 0 | 7 ✗ | 6 ✗ | **0 ✓** |
| C5 poor/hard pairs ≥ 0.50 (count) | 0 | 6 ✗ | 17 ✗ | **0 ✓** |
| C6 strong pairs ≥ 0.50 | 0.70 | 0.33 ✗ | 0.50 ✗ | **0.75 ✓** |
| C7 median strong − median poor | 0.20 | 0.19 ✗ | 0.25 ✓ | **0.42 ✓** |
| C8 incomplete profile ≥ 0.50 (count) | 0 | 0 ✓ | 0 ✓ | 0 ✓ |
| C9 location-bug twin gap | 0.05 | 0.23 ✗ | 0.25 ✗ | **0.00 ✓** |
| C10 mean NDCG@5 | 0.85 | 0.77 ✗ | 0.69 ✗ | **0.86 ✓** |

**Held-out split (3 personas, confirmatory)**

| Criterion | bound | deployed | main | candidate |
|---|---|---|---|---|
| C1 | 0.90 | 0.97 ✓ | 0.97 ✓ | 1.00 ✓ |
| C2 | 0.75 | 0.86 ✓ | 0.71 ✗ | 0.86 ✓ |
| C3 | 0.75 | 0.77 ✓ | 0.80 ✓ | 0.84 ✓ |
| C4 (count) | 0 | 8 ✗ | 5 ✗ | **0 ✓** |
| C5 (count) | 0 | 14 ✗ | 12 ✗ | **2 ✗** |
| C6 | 0.60 | 0.67 ✓ | 0.67 ✓ | 0.83 ✓ |
| C7 | 0.20 | 0.19 ✗ | 0.22 ✓ | 0.31 ✓ |
| C10 | 0.85 | 0.85 ✓ | 0.75 ✗ | 0.87 ✓ |

Score distributions (0–1), development: strong median 0.46 → 0.50 → **0.62**,
poor median 0.26 → 0.25 → **0.22**, highest hard mismatch 0.53 → 0.50 → **0.20**.
Held-out strong 0.54 → 0.55 → 0.58; poor 0.34 → 0.33 → 0.27.

**What still fails.** Held-out C5: two poor pairs for the Azerbaijani/Russian
call-centre persona sit at 0.513 (HR specialist) and 0.508 (locksmith), and one
strong pair at 0.499 (civil engineer → "İnşaat mühəndisi"). The 0.50 floor is
therefore *borderline* for Azerbaijani-language profiles: the multilingual model
rates any two Azerbaijani texts as similar. Pairs at or above 0.50 (development +
held-out, 24 pairs): 22 relevant (precision 92%); strong pairs reaching it: 15 of 18
(83%). The candidate improves every held-out criterion over both baselines; it does
not meet the zero-false-positive bar. Per the rule set in advance, the evidence
does **not** justify changing the email floor: raising it would drop strong
matches (three strong pairs sit between 0.50 and 0.53), lowering it adds noise.
**`MATCH_EMAIL_MIN_SCORE` stays at 0.50, `MATCH_SCORE_THRESHOLD` at 0.35.**

## 5. What changed in `pipeline.py` (evidence-backed only)

| Change | Evidence |
|---|---|
| Whole-document semantic weight 0.35 → 0.15; role 0.25 → 0.30; skill 0.20 → 0.25; keyword 0.20 → 0.30 | Semantic barely separated strong from poor (unrelated Azerbaijani pairs score 0.70–0.83). Only three of 768 weight/floor combinations passed every development criterion, all with semantic ≤ 0.15. No score rescaling or inflation; applied to production's average component values the mean base score is unchanged to within 0.01 (arithmetic estimate, not a measurement on real pairs) |
| Generic concepts (communication, teamwork, office tools…) ignored for keyword overlap | A cook and an accountant both "require communication"; matched-keyword chips were meaningless |
| Stems with non-ASCII letters match inflected forms; "analitik"/"analyst"/"kadrlar" added | `Hüquqşünas`, `mühəndisi`, `Business Analyst` matched no concept. ASCII aliases stay strict (regression-tested) |
| Equivalent title credits role fit; regulated occupations discounted ×0.4 unless the profile's headline/roles/titles show them | doctor posting scored 0.50 for a nurse; "Director of Engineering" for a developer |
| Experience gap penalty grows with the gap (×0.7 / 0.55 / 0.4); education gap of two ranks ×0.65 | 9+ years required of a 4-year candidate was only ×0.7 |
| `azerbai` marker replaced by language-context patterns | "Azerbaijani market" in a company blurb caused a false missing-language penalty on good matches |
| Employment-type strings are an unknown location | `Tam ştat` postings scored 0.25 lower for the same job |

Not changed: store/email thresholds, rate limits, deduplication, the API adapter,
the model or its pin, any stored score.

## 6. Limits — not claimed

- The set is synthetic and small (52 postings, 10 profiles). Weights were chosen
  on seven personas; a narrow region passed. Real-world performance is unproven
  until shadow-scored on real profiles with consent.
- Only 43% of real titles contain a concept the dictionary knows; for the rest the
  scorer relies on embeddings and the role/skill terms. Two development personas
  test that, both pass, but two personas are not a coverage claim.
- The model is weak in Azerbaijani; the floor is borderline for Azerbaijani-language profiles.
- No outcome data, so nothing here is a probability; do not present it as one.
- Not run against production profiles (no bulk recalculation, no shadow run, no
  personal data processed).

## 7. Rollout requirements

The scorer only changes production when the `matching-service` image is replaced (prebuilt, verified image ID
and CPU, previous image kept; `docs/release-2026-09-30.md` §10). Nothing recalculates stored scores by itself.
Existing matches keep their old scores until a re-score, which is a deliberate, named **rollout**
(`script:rescore-profiles:prod`):

- **Serial and replay-safe.** One profile at a time (queue global concurrency 1, worker concurrency 1, at least
  the rollout's spacing per profile, 30–3600 s, default 120 s), in a dedicated queue so delays, overdue jobs and
  retries cannot overlap. Jobs are kept (completed and failed) under `rescore-<rollout>-<user>`: repeating the
  same `--rollout` adds nothing for any profile that already has a job; a failed profile is retried only with
  `--retry-failed`; a deliberate new pass uses a new rollout name. Proven through real BullMQ and Redis, with
  mutation checks (completed-job removal, loss of concurrency control).
- **Silent mode (`--silent`, required choice against `--notify`).** Matches are stored and shown in the app as
  usual, but the rollout announces nothing: no `match-created` job, no in-app notification, and the stored marker
  `Match.suppressedRollout` keeps the email flush, the re-arm after a restart and the paid daily digest away from
  them — including existing unsent matches whose score this rollout refreshes. `notifiedAt` is never faked (it
  keeps meaning "an email was sent"), and normal notifications for later matches are untouched.
- **Quota.** Entitlements are unchanged: a silent match still consumes one unit of the plan's monthly quota
  (Free: 3), created best-first, and usage is never reset or expanded. A Free user's remaining monthly quota may
  therefore be spent by the backfill on their best current matches; those matches appear in the app without an
  email. Existing matches are refreshed in place and use no additional quota.
