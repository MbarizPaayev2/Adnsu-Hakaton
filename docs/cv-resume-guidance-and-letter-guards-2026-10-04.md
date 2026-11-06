# CV / resume guidance adapted from the engineer's folder, and two letter-guard limits closed (4 October 2026)

Scope: the existing pipeline only (`parseCv` → career entries → `buildPersonaFromProfile` → `ResumeTailorService` → `reconcileWithFacts` / `reconcileLetter` → review → approval → PDF). No second generator, no new document kind, no API change. Review, approval, snapshots, allowances and e-mail attachment hashes are untouched.

## 1. What was taken from `ats-harvard-resume`, and what was not
Read: its prompts (`src/prompts/__init__.py`), extraction/rewrite flow (`nim_client.py`), the year-provenance check (`ats_check.py`), the Harvard spec and config. I did not open its sample input/output files (they contain a person's CV) and copied no code.

| Engineer's rule | Here |
|---|---|
| Extraction must be complete: "NEVER drop an entry to save space" | The CV parser silently cut at 15 roles, 10 schools, 40 skills and 60 career suggestions. Limits are now 40 / 20 / 80 / 100 and anything beyond them is reported in `parsedContent.omitted` instead of vanishing. Re-extraction never touches confirmed entries (see 2.1) |
| Keep every entry in rewriting; condense wording, not entries | Already true here (every saved role is kept with its exact company/position/period); the prompt now says so and why: the full career is kept elsewhere |
| Bullets start with an action verb, state the fact with its numbers, ≤ 25 words | Adopted in the prompt as **action + contribution + result when the persona states one**. The engineer's spec also says "quantified / X-Y-Z"; that was **not** adopted, because it pushes a model to invent numbers |
| "If there is no metric, state the fact plainly without faking one" | Adopted verbatim in spirit: numbers are never required, estimated or invented |
| Forbidden filler ("responsible for", "accomplished", "measured by", "by demonstrating", "leveraging", "utilizing") | In the prompt, and as a **warning** (`filler_phrase`) in the review notes for en/az/ru/tr wording (the bullet is kept) |
| Skills verbatim; no skill dumping | Prompt: no stringing the skills together in summary/bullets, tools named only where they explain the work. Warning `skill_list` for a sentence naming ≥ 4 of the candidate's own skills (also for CV/resume text now, not only letters) |
| Year/number provenance guard | We already reject any number not in the candidate's facts (`unsupported_number`); that stays the hard check |
| 3–6 bullets per role | Not forced: a role with one saved line keeps one. Resume ≤ 4 and CV ≤ 8 per role, as before |
| Python/NIM client, `[NOT FOUND]` placeholders, ASCII-safe headers, its own renderer | Not adopted (parallel generator; our Typst templates already render the Harvard single-column layout with localized headings) |

## 2. Changes by priority
1. **Confirmed career entries survive extraction.** A new unit spec (`career-entries.upload.spec.ts`) pins that a re-upload never deletes, updates or duplicates an existing entry (including one the candidate retitled), that an extraction finding fewer entries removes nothing, and that only genuinely new ones are added, as unconfirmed suggestions, within the 150-entry limit.
2. **Complete master, relevant concise resume.** The persona/master holds every confirmed entry; `selectCareerSections` picks for the document. A new unit spec (`career-selection.spec.ts`) pins that the master is complete and untouched by selection, a resume keeps at most two relevant projects and the relevant certificates, a CV keeps all, and unconfirmed/hidden/story entries never reach a document. The resume prompt now says to choose by relevance for the vacancy and order by it.
3. **Specific bullets** (prompt): action verb, what was done or contributed, the result only if stated; unique; ≤ 25 words; no first person.
4. **Metrics are preserved, never required.** Prompt: keep every number/name/tool the persona states for a role as written. Code (hardened the same day, see `document-quality-verification-2026-10-04.md`): a number must belong to the role it appears in and keep what it measured; a lost metric is restored by replacing the near-duplicate bullet (or adding the saved line while there is room), never as a duplicate and never in another language than the document; otherwise `dropped_metric` tells the candidate. A role whose source has no number is never asked for one; an invented number is still removed.
5. **Filler / skill dumping / unsupported claims:** see the table; unsupported claims still use the unchanged generic fact check.
6. **Language and terminology:** the selected language still wins; the prompt adds that tool, product and standard professional terms stay as professionals write them in that language (Power BI, PostgreSQL, API, backend), names are never translated.
7. **Unchanged:** review, approval, snapshots, allowance accounting. The web review screen has Azerbaijani labels for the new notes.

## 3. The two letter-guard limits
1. **A feeling word elsewhere in the candidate's text no longer supports an unrelated personal claim.** Support is now sentence-level: a generated sentence with a feeling/taste/hardship marker is kept only if one of the candidate's **own sentences** uses the same kind of marker and is about the same subject (they share a content word) or is wholly contained in it. "Komanda ilə işləməyi sevirəm" no longer supports "Bu şirkətin məhsullarını sevirəm" (same for English and Russian); it still supports a statement about teamwork. A different kind of feeling word is not accepted either.
2. **The target employer named in the vacancy is not proof the candidate worked there.** A letter sentence that mentions the target employer **and** uses past-employment wording ("işləmişəm", "çalışmışam", "təcrübəm var", "worked", "previously", "работал", "ранее" …) is removed as `unsupported_employer_claim` unless the candidate's own facts (profile, stories, what they typed) already name that employer. Legitimate statements stay: "… vakansiyasına müraciət edirəm", "… şirkətində işləmək istərdim", "I am applying to …".
Regression tests cover both, each with the opposite case that must still pass.
**These are keyword heuristics.** They catch the listed wordings; a differently worded claim can slip through, and a sentence that passes is not thereby proven grounded. The approval step and the candidate's review remain the control.

## 4. Verification run
`src/resumes` + `src/career`: 8 suites, **156 tests** pass. E2E with the deterministic fake provider, one file at a time (`--runInBand`): `tailored-cv` 10, `career-evidence` + `documents` 32, all pass. **Do not run API e2e files in parallel against the shared test database:** a first parallel run produced 15 failures that disappeared when run in band (the known shared-database interference). API build typecheck and web typecheck clean; no full suite repeated.

## 5. Before/after evaluation: prepared, **not run, blocked**
`apps/api/test/evals/` now compares the prompts of commit 12e3570 (`legacy-prompts.ts`, verbatim) with the current ones on the same synthetic cases: three languages × resume/CV/letter, a **rich Azerbaijani career** (five roles, metrics, nine skills, three projects, two certificates, vacancy asking for Kubernetes/Kafka the candidate lacks), and two Azerbaijani short answers (current prompts only). Both arms run through the **current** code guards, so the comparison isolates the prompts. Budget: 3 requests per generation (78 for the full run). `--arms=before` / `--arms=after` run one arm.
Recorded per output (mechanical, heuristic): roles kept versus the master, supplied metrics kept, invented numbers, filler bullets, skill-dump sentences, bullet counts and length, skills kept verbatim, surviving personal claims, answer length, Azerbaijani wording flags, latency, tokens, cost (only with supplied prices), PDF pages.
Judgement is left to people: `blind-ab-sheet.md` shows before/after as anonymous "A"/"B" per document (arm key in a separate file) and `az-review-sheet.md` shows every Azerbaijani letter/answer for independent naturalness review. One run per case is anecdote, not a statistic.
**Status:** no provider key is available here, so **quality evaluation is blocked**; the harness refuses a loopback endpoint. Its mechanics (arms, metrics, blind sheets) were exercised once with the deterministic fake through a throw-away copy with the preflight bypassed. **That fake restates the persona and ignores the prompt, so its before and after outputs were identical; it proves the harness runs and nothing about improvement.**

## 6. Reported separately
* **Prompt and code changes:** as above, tested with unit fixtures and the fake provider only.
* **Real-model quality results:** none. Whether the new CV/resume prompt produces more specific bullets, keeps metrics better or reads more naturally on a real model is **unmeasured**.
