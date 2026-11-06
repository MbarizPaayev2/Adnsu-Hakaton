# Complete Azerbaijani document translation — 14 October 2026

## Reported failure and verified cause
The supplied CV has four English bullets despite Azerbaijani headings; the supplied letter contains English experience text. A real-provider reproduction with the same four bullet texts accepted 0/4 on the production translator. Its guards misclassified ordinary title-case words and ordinals as immutable names, treated monetary `gəlir` as a verb, rejected XGBoost's own stated result as candidate voice drift, and rejected ongoing work combined with completed milestones. A connector inside the official programme name `Youth in Development Fellow` was rejected as English leakage.

## Change
- Translate from one shared field inventory for generation, retry and approval: bullets, summary/headline, project/activity/certificate descriptions, job labels, education labels, skills and language proficiency.
- Common professional labels use a deterministic glossary without an AI call. Personal identities, employer/programme names and technical products retain their source spelling.
- Correct the specific false positives while retaining number/name/tool checks, invention rejection, language checks and approval blocking for unresolved prose.
- Translation batches are bounded by both item count and characters, two workers, up to three provider attempts per batch and a maximum two-minute document deadline. Accepted items are not repeated; existing documents retry only unresolved fields.
- Persist all accepted fields and their source wording in an optimistic, owner-scoped document revision/snapshot. A concurrent edit rejects the stale translation save; no document allowance is spent. Review retains verified label/skill translations without adding arbitrary roles or skills.
- The retry message reports pending fields; it claims complete translation only when none remain.
- Add an Azerbaijani XYZ guide beside profile experience inputs: result, evidence, action; separate lines; candidate voice; a numeric and a nonnumeric example; no fabricated metrics or overstated team contribution.

## Evidence
The corrected translator accepted all four reported bullets in a bounded real-provider run (three calls across Groq and NVIDIA). This proves those cases pass, not universal language quality. Provider outages or a genuine fact/language rejection still leave the original wording flagged and unapprovable. Keep candidate review mandatory.

Targeted regression tests cover the reported name/ordinal/voice/tense issues, official-name connectors, invented numbers/tools/names, short English prose, deterministic labels, immutable source profiles, saved skill aliases, complete retry persistence and concurrent edits. Exact-head/merge CI, backup/restore, exact-image checks and production verification remain release gates.

No candidate application, employer message or payment was sent. Personal regression data and model responses are temporary private files, not committed. Prior coverage PR #65 is separate and unmerged.


## Release-image follow-up: embedded role titles

The first native image probe accepted every reported CV section, but the provider retained generic English job titles inside translated letter paragraphs. The release was stopped. Known role labels now translate deterministically only in Azerbaijani role/vacancy contexts before validation. The name guard recognises the corresponding Azerbaijani role vocabulary only when that role exists in the source, including PDF-separated `Co- Founder`. Programme/product names outside those contexts stay unchanged; invented organisation names still fail.

Replaying the captured failed provider output after this fix leaves neither letter paragraph rejected, without any further model requests. The four focused suites pass 164 tests and the API build passes. This is intermediate evidence; the final exact-image real-provider check, fresh backup/restore and deployment verification remain required before a live claim.


## 15 October follow-up: equivalent selection numbers

The final pending field used natural Azerbaijani `20‑dən biri` for source `1 of 20`. The numeric guard now accepts this specific equivalent selection construction, including non-breaking hyphens, only when that source selection exists and no other standalone 1 must be preserved. Changed selection totals, omitted awards and ordinary missing quantities still fail. Translation output space is now 1536–3200 tokens, allowing room for Azerbaijani and reasoning while keeping the existing hard ceiling.

The isolated native preflight, with the candidate compiled translator mounted read-only and no production database access, translated the remaining section in one Groq request. All four reported CV sections and both mixed-language letter paragraphs are complete across the retained test snapshots. Already accepted outputs were retained instead of requesting them again. The four focused suites pass 166 tests and the API build passes. Final image validation, exact-commit CI and fresh backup/restore are still release gates.
