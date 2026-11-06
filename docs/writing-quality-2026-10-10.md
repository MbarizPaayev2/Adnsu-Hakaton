# Document writing quality: the evidence-first writer (10 October 2026)

Status: **implemented behind `TAILOR_AZ_WRITER` (off by default); evaluated on five synthetic candidates against the same vacancies, before and after; rolled out only with the flag, with a one-line rollback.** This is not a native-reader approval: no native reader of Azerbaijani has reviewed these texts yet, and the mechanical checks below cannot establish that a text is natural.

## 1. What was wrong (measured, `before/` set)
The composed Azerbaijani letter was safe but templated: the candidate's own sentence + "Bu, <position> üçün elandakı «<copied requirement line>» tələbi ilə bağlıdır." + "Təcrübəmi və motivasiyamı görüşdə ətraflı izah etməyə hazıram." In the comparison set, 3 of 5 letters copied a requirement line of the vacancy verbatim and all 5 contained at least one of the same filler frames. The CV kept the candidate's wording verbatim, including typos ("mühasibatliq", "hazirladim"), a mix of first and third person, and tenses that did not match whether the role had ended.

## 2. What changed
| Stage | What it does | What it may not do |
|---|---|---|
| Evidence | Confirmed items only (experience, projects, activities, certificates, stories, education) with role and period, ranked by relevance to the vacancy; periods are written as `2021-03 – present`, so an English month is never copied; a running period is marked as current. | Add anything unconfirmed; the original evidence is never overwritten (the polish works on a copy). |
| Writer | A hosted model (Nemotron 3 Ultra first, Kimi K3 as fallback) re-expresses the evidence as an Azerbaijani letter of 2–4 paragraphs, or each CV bullet in one voice and tense. | Receive the vacancy text beyond the position, the employer and the requirement lines; invent. |
| Gates (deterministic) | invented/dropped figures, new tool or organisation names, inflated claim words, changed scope ("helped" → "did"), copied requirement lines, repeated openings, first person plural, a letter that does not name both position and employer, a word that does not exist (see below), a broken vowel harmony, a changed short word (`ildə` → `ilə`), mixed person in a CV. | Be bypassed: a rejected draft is returned to the writer once with the exact problems. |
| Fact-checker | A second call (a model acting as a fact-checker) lists unsupported statements. | Be relied on alone: it did not notice invented or misspelled words in the evaluation. |
| Fallback | Anything rejected, slow or unavailable falls back to the composed letter / the candidate's own bullet wording. | Block the document. |
| Review | Every changed bullet is listed beside the candidate's original; evidence the letter left out is listed; both are "to check", and approval never claims the model was right. | |

### The word check (why it exists)
A hosted model asked to re-express confirmed evidence sometimes returns a word that does not exist: "məşğələlər" → "məşğülələr", "məsləhətçi" → "məshələtçi", "bütçəni" → "bütlər", "gündə orta" → "gündüzlükorta", Turkish "gündelik", "qurdi" for "qurdu". Two hosted models used as proofreaders missed some of these and flagged correct words, so the check is mechanical (`az-words.ts`): a word is known when it is the candidate's own word, a word form seen at least twice in AISE's published vacancy texts (11.8k forms, no sentences, `az-lexicon.json`), an everyday function word, or a known root plus a well-formed, vowel-harmonious run of endings. It compares exact letters (a Turkish `e` is not `ə`). It can reject a correct rare word; the cost is a fallback.

## 3. Before/after on the same facts and vacancies (synthetic candidates, real model, real service)
Mechanical measurements (`pack-final/comparison.json`, kept outside Git with the anonymous review pack):

| Case | Kind | Words (before → after) | Requirement lines copied | Filler frames | Invented numbers | PDF |
|---|---|---|---|---|---|---|
| student-backend | CV | 30 → 38 | 0 → 0 | 0 → 0 | none | compiles |
| student-backend | letter | 71 → 66 | 2 → 0 | 4 → 1 | none | compiles |
| junior-sales | CV | 22 → 22 | 0 → 0 | 0 → 0 | none | compiles |
| junior-sales | letter | 72 → 51 | 2 → 0 | 3 → 0 | none | compiles |
| experienced-hr | CV | 55 → 57 | 0 → 0 | 0 → 0 | none | compiles |
| experienced-hr | letter | 60 → 55 | 0 → 0 | 1 → 0 | none | compiles |
| sparse-quality | CV | 4 → 4 | 0 → 0 | 0 → 0 | none | compiles |
| sparse-quality | letter | 50 → 24 | 2 → 0 | 3 → 0 | none | compiles |
| marketing-content | CV | 42 → 42 | 0 → 0 | 0 → 0 | none | compiles |
| marketing-content | letter | 59 → 96 | 0 → 0 | 1 → 0 | none | compiles |

What the reading (by the engineer, not a native reader) found:
* **Letters:** all five are written from the evidence in the candidate's voice, name the position and employer, are specific to the candidate's own experience, and do not copy the vacancy. They are not flawless: acronym case endings ("MMC-da" for "MMC-də"), occasional list-like sentences, a missing "kimi" ("satış məsləhətçisi işləyirəm"), "PASHA Bankın". A draft with a wrong word is caught and rewritten; a valid word used wrongly ("orta ilə" for "orta hesabla", "ilin" for "ildə") is **not** caught mechanically and appeared in earlier runs.
* **CVs:** typos are corrected and the voice and tense are consistent (present for the current role, past for ended roles). When any bullet of a CV cannot be verified, **none** is changed and the candidate is told, because a CV that mixes "etdim" and "etdi" reads worse than either.
* **PDF design is unchanged** (the same Typst templates; two pages were rendered and read). EN, RU and TR documents never reach the writer: their code paths and prompts are untouched, their suites pass, and six real-provider control generations in the canary produced documents.
* **Latency:** a letter takes 8–70 s (up to 7 provider calls when a draft is rejected twice); it is asynchronous, so the candidate waits on the pending screen as before.

## 3b. Production-like canary and adversarial checks (11 October, release image's code on the production host, real provider)
**Canary:** 12 synthetic Azerbaijani candidates across job families (accountant, frontend developer, nurse, fresh teacher, logistics, lawyer, civil engineer plus the first five) with names, abbreviations and technical terms (ASC, MMC, SOCAR, PASHA, React, TypeScript, AutoCAD, IELTS), 24 Azerbaijani generations and 6 EN/RU/TR controls.

| | Letters (12) | CVs (12) |
|---|---|---|
| Writer output used (verified) | 11 | 11 |
| Fallback, labelled (`writer_fallback` / `missing_rewrite`) | 1 (provider timeout, composed letter) | 1 (a rewrite could not be verified, the candidate's own wording kept) |
| Failed generations | 0 | 0 |
| Provider requests per generation | 2–5 (bound 8) | 2 |
| PDF compiled | 12 / 12 | 12 / 12 |

EN, RU and TR controls (6 generations) took the unchanged paths and produced documents; the writer was not called.

**Reading the outputs against the evidence (engineer, not a native reader)** found one genuine attribution error that the gates had not caught: a role's "Daşınma xərclərini 8% **azaltdım**" (I reduced) became "…8% **azaldı**" (it decreased), which changes who did the work. A causative/intransitive gate (`voice_changed`) was added with a unit test and the pairs azalt/azal, yüksəlt/yüksəl, yaxşılaşdır/yaxşılaş, sürətləndir/sürətlən, gücləndir/güclən, sadələşdir/sadələş. A looser nuance ("Şirkətlərin" → "Şirkət") was also seen and is **not** caught.

**Adversarial insertion test** (40 plausible but unsupported sentences, five accepted letters, no numbers or tools in the inserted text: invented leadership, responsibility, unquantified result, skill claim, impact, event, relationship, training): the deterministic gates rejected 29 / 40 (72 %), the model fact-checker rejected 39 / 40 (97.5 %), together 40 / 40. Of 5 faithful control letters, 0 were rejected by the gates and 1 by the checker (a false alarm costs a retry, not a wrong document). These insertions are blatant; subtle drifts (nuance, plural/singular, a verb's causative form) are only partly covered, which is why the candidate review stays.

**Spelling guard false rejections:** nine correct sentences with proper names, abbreviations, technical terms and legitimate inflections are accepted in a unit test; two common words missing from the vacancy-derived lexicon ("nəfər", "doktorantura") were found by that test and added to a curated common-vocabulary list. Rare correct words can still be rejected (the cost is a fallback).

**Safety properties (unit-tested):** the candidate's evidence object is not mutated (deep-copy comparison); approved paragraphs of a regenerated letter stay word for word; a fallback carries `writer_fallback` and is never recorded as `written`; writer calls and tokens are added to the generation's accounting; calls are bounded (two models × two attempts × writer+checker for a letter, three for CV bullets) and a deadline of 170 s applies.

## 4. Unresolved weaknesses (not hidden)
1. No native-reader judgement exists yet. The anonymous review pack (`review-pack.md`, key kept private) is ready; naturalness, register and idiom are not established.
2. Grammatically valid but wrong phrases (see above) pass the gates; the candidate's review is the only check.
3. The fact-checker model is weak on Azerbaijani; it is a second opinion, not the control.
4. Sparse candidates get short letters (24 words in the evaluation); the product says so instead of padding.
5. The lexicon is built from vacancy language (third person, formal); first-person forms are generated from verb roots, so some correct forms are rejected and fall back.

## 5. Inputs from the candidate (no heavy onboarding)
The letter composer's four questions are optional ("istəyə bağlı"); "I don't know" or empty is a valid answer and the letter is then built only from confirmed evidence; extra points travel as evidence, not as the candidate's reason. The review screen shows each reworded bullet (original → new) and the confirmed experience a letter did not use.

## 6. Rollout, flags and rollback
* `TAILOR_AZ_WRITER=true` enables both the letter writer and the CV polish for Azerbaijani only. Related: `TAILOR_AZ_WRITER_MODELS` (default `nvidia/nemotron-3-ultra-550b-a55b` since 11 October; kimi-k3 timed out), `TAILOR_AZ_JUDGE_MODEL`, `TAILOR_AZ_WRITER_TIMEOUT_MS` (60 000), `TAILOR_AZ_WRITER_DEADLINE_MS` (170 000). Allowance accounting, the quote, approval snapshots and document kinds are unchanged.
* **Rollback:** `scripts/host-config.sh flag TAILOR_AZ_WRITER false`, then recreate only the API (`RELEASE_SHA=<running> docker compose up -d --no-deps api`). Documents already generated stay as they are.
* **Budget:** the final comparison run used 30 provider requests (the evaluation as a whole, with the earlier model comparisons, a few hundred); production adds at most 7 requests per letter and 3 per CV, bounded by the 170 s deadline, and falls back when the provider is unavailable.
