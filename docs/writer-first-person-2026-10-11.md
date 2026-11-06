# Writer revisions after the founder's first review (11 October 2026)

Status: **implemented on branch `codex/writer-first-person-20261011` (PR #49, stacked on #46); not deployed; human quality gate pending.** The founder's review of six anonymous pairs was qualitative: it is not a passed gate and no native-reader approval is claimed. The six reviewed pairs are now development material.

## What was changed (all deterministic where it can be)
| Founder point | Change | Where |
|---|---|---|
| CV bullets in the candidate's first person | Regular third-person verbs at the end of a role bullet become first person by code (`hazırladı→hazırladım`, `edir→edirəm`); the model prompt asks for first person; a rewrite that is third person or mixed is refused. Passives, result verbs, nouns that end like verbs and bullets with a team/bank as subject are left as written. | `az-voice.ts`, `az-rewrite.ts`, `az-writer.ts`, `resume-tailor.service.ts` |
| Keep the candidate's own tense | `yoxlayırdım` is not turned into `yoxladım` (also the causative `çatdırırdım→çatdırdım`); a tense change is refused. | `az-rewrite.ts` (`tense_changed`) |
| Substantive bullets, no padding | Nothing is added beyond confirmed facts. A role told in ≤3 short bullets gets an optional `add_detail` question. | `resume-tailor.service.ts`, review UI |
| Correct date/case grammar | Periods are written by code (`2023-cü ildən 2024-cü ilə qədər`, `2022-ci ilin yanvarından 2023-cü ilin mayına qədər`); `2023-dən`, `2024-cü il kimi`, `2023-cü il tamamlamışam`, wrong ordinal vowels are refused. | `az-dates.ts` |
| Role fit and honest reasons | Letter order: what I did → how it relates to the vacancy (one natural sentence per requirement with evidence) → the candidate's reason for the employer. Reasons for the role and the employer are the candidate's own words only; wishes/feelings they did not write are refused. | `az-writer.ts`, `az-rewrite.ts` |
| Optional evidence collection | Letter form asks separately "Niyə bu rol?" and "Niyə məhz bu şirkət?" (new `companyReason`), plus example and contribution/result; skipping is valid and a `reason_missing` note says no reason was written. | `motivation-letter-composer.tsx`, DTO, processor |
| Fuller letters, not inflated | Target length 60–190 words from evidence and reasons; a short letter that leaves out expected evidence is asked for again once (style), never padded; a sentence told twice is dropped. | `az-writer.ts`, `az-rewrite.ts` |
| Do not substitute a certificate for a degree | A degree requirement is answered only by education; a certificate only answers a requirement about a certificate/course; named as təlim/vəsiqə/diplom/sertifikat. | `az-letter-compose.ts` |
| Natural transitions in the fallback | The composed letter now tells roles as sentences (`Bu müddət ərzində …`) with code-written dates, instead of a list after a template. | `az-letter-compose.ts` |
| Corrupted words | A restored diacritic must keep vowel harmony (`etdim→etdım` refused); `rollunda` refused; abbreviations are never lower-cased into dotless `ıt`. | `az-words.ts`, `az-letter-compose.ts` |

## Evidence (synthetic candidates; real provider; provider 429 on about 40% of calls)
* Unit/e2e area: 509 tests in `src/resumes` and `src/documents` pass; 1,523 API unit tests; 31 web document tests.
* Six reviewed cases regenerated with the same facts, again with synthetic optional answers, and six untouched cases (`second-review-batch-2026-10-11.zip`, outside Git): final letter run **6 of 11 letters written by the writer** (5 labelled fallbacks), CVs 6 of 6 first-person; across five tuning runs the writer's share ranged from 1 to 6 of 11.
* Known weaknesses: model drafts with corrupted words, plural first person, copied vacancy lines or repeated phrases are refused and fall back to a plainer composed letter; one confirmed fact yields a short letter; no native reader has judged naturalness.

## Not done / pending
* Founder review of the second batch. Nothing here is deployed; production keeps the composed documents (`TAILOR_AZ_WRITER` unchanged).
