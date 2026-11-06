# Matching review resolution — 26 October 2026

This is development evidence for PR #120, not a production acceptance or outcome study. No match revalidation, notifications, merge, or deployment was run.

## C3 evaluation correction

The old evaluator assigned both `poor` and `hard` labels grade zero, then compared every partial against every grade-zero item for C3. That made C3 include hard qualification/seniority cases, although C4/C5 separately measure hard mismatches. It also ranked postings that explicit candidate preferences correctly vetoed to score zero.

The evaluator now compares the exact labels `partial` vs `poor`, excluding `hard` from this ranking criterion. It further excludes a pair only when either posting conflicts with an explicit candidate location, work-arrangement, seniority, or stated citizenship requirement. It does not exclude pairs based on role relevance, because role relevance is part of the ranking being assessed. The C3 threshold remains 0.80 for development and 0.75 for held-out. Historical grade-collapsed results remain printed for audit.

| Rules evaluation | C3 eligible partial > poor | Eligible / labelled pairs | Historical grade-collapsed C3 |
| --- | ---: | ---: | ---: |
| v1 development | 0.871 (pass) | 596 / 851; 255 excluded by explicit preferences | 0.742 |
| v1 held-out | 0.561 (below 0.75) | 187 / 264; 77 excluded by explicit preferences | 0.479 |
| v2 development | 0.985 (pass) | 549 / 549; none excluded | 0.986 |

In the v1 development data, some previously-labelled partial vacancies conflict with the candidate's stated preferences. For example, the D3 persona requests onsite work in Baku, while j17 is in Ganja and j30 is in Sumqayit. These labels were not changed. The threshold was not lowered. The held-out result is below its bar and is not being tuned against; this is a quality limitation to carry into independent evaluation.

The v2 development run also retains its known non-gating C5 failure: one poor/hard pair at the email floor. CI deliberately runs v2 with `--gate none`; the v1 development criteria are the blocking development gate.

## Imported job facts and admission contract

- `MatchableJob` now carries the normalized `Job.workArrangement` column.
- `buildJobPayload` preserves an explicit source arrangement; when a Glorri payload omitted it, a shallow copy receives the established row fact. Generic imports include the row fact. Raw source JSON is never mutated, and absent values stay unknown.
- Candidate-stated citizenship is passed from the Prisma profile through the API persona adapter. An Azerbaijani-citizenship veto is applied only when the vacancy text states a mandatory requirement; a preferred citizenship phrase and unknown candidate citizenship remain neutral.
- The Python scorer emits both current and compatible veto-field aliases (`location`/`location_ok`, `work_arrangement`/`work_arrangement_ok`, `seniority`/`seniority_ok`, `citizenship`, `recommendation_eligible`). The API admission helper recognizes both PR #117 and #120 spellings. Notifications use that same helper.
- Generic quality-control and HSE occupations no longer alias to software QA or civil engineering. They have separate occupation identities; the lexicon and rules cache version changed accordingly.

PR #117 and #120 remain separate open PRs. PR #120 now includes the safe admission-contract union and citizenship field bridge, but does not copy the unrelated motivation-suggestion changes from #117. Before either PR is merged, rebase/integrate them against the current main and run exact-merge CI; preserve notification admission and both scorer modes.

## Existing match records

The rules cache key changes with the scorer version/lexicon; newly-built arrangements and citizenship facts also change the request content. This invalidates corresponding in-memory parsed-job cache entries, not persisted `Match` rows. Existing scores are not automatically recalculated, and no revalidation task was run. Any later rollout should be a bounded, silent rescore with no notifications and must preserve application history.

## Verification run

- `python3 rules_selftest.py`: passed all 25 printed checks, including raw posting adapters, both scorer-policy paths, unknown citizenship, mandatory citizenship, preference wording, QA/HSE collisions, and remote/hybrid/onsite compatibility.
- API matching tests: 6 suites, 102 tests passed. This includes the actual `/score` request payload test for normalized work arrangement and candidate citizenship.
- API build/typecheck: `npx tsc -p apps/api/tsconfig.build.json --noEmit` passed.
- v1 development rules evaluation: C1–C10 passed using the development gate after the C3 contract correction. All-split run exits successfully under the configured dev-only gate; held-out C3 remains reported as failing its non-gating bar.
- v2 development rules evaluation was run with `--gate none`; C3 passes and the known C5 failure is reported.
- Python modules compiled; `git -c core.whitespace=cr-at-eol diff --check` passed.
- Cache selftest still requires the matching service's compatible FastAPI environment. It was not claimed as passed.
