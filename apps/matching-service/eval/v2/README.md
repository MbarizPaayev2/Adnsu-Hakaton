# Evaluation set v2 (created 3 October 2026)

50 synthetic postings (Azerbaijani, Russian, English) and 11 synthetic personas with engineer-written labels, **written before any scorer was run on them**
(the commit that adds this directory contains no scorer output). Built by `build.py`; the JSON files are generated and committed.

- **Not independent human review.** The labels were written by the engineer who also writes the scorer. No native speaker has reviewed the postings, the personas or the labels.
- `dev` personas (Q1–Q7) may be used while changing the rules scorer. `sealed` personas (S1–S4) are not scored until the scorer is frozen; they are scored once and the result recorded.
  Anything changed after seeing sealed output turns the sealed split into a development set, and the report must say so.
- It targets the four documented rules-mode problems (customer vs IT support, manager/seniority, subject-specific occupations, adjacent occupations) plus mandatory
  restrictions (ACCA required, driving licence required, Russian required), an incomplete profile and a head-of-department posting for a junior.
- The earlier v1 set (`../`) and its held-out results are historical evidence: they were inspected on 3 October and are not independent for the changes made after that.

## Status (3 October 2026, end of session)
The sealed split (S1–S4) was scored once with the frozen scorer `rules-v1.2` / lexicon `2026-10-03.4` (commit `e7fcf58`) and, for comparison, with the embedding scorer. **It is consumed:** a further scorer or
lexicon change turns it into a development set. Two pairs are disputed labels (Q4/v37, S3/v29) and were kept as written. Results: `docs/evidence/rules-v2-eval-2026-10-03.txt`.
