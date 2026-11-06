# Document-quality work: checkpoint (11 October 2026)

Status: **in progress, NOT evaluated, NOT deployed.** Everything here is unit-tested code on a branch; no before/after claim is made yet. No native reader has reviewed anything.

## What changed so far (all deterministic, no model training, no PDF/template change)
| Area | Change | Evidence it was needed |
|---|---|---|
| Case endings after abbreviations | `az-acronyms.ts` repairs the vowel of the ending ("MMC-da" → "MMC-də", "SOCAR-də" → "SOCAR-da", "ASC-da" → "ASC-də") before gates; judged only when every plausible reading agrees ("HR", "PR", "MBA", "ABŞ", digits are left alone); traced as `repaired:acronym_endings:N` | 4 of 8 accepted baseline letters on the dev set contained a wrong ending |
| Invented name behind a hyphen | `namedTerms` now judges every hyphen/slash segment; new `stray_hyphen` gate | an accepted baseline letter contained "ildən-Étienne Şərq Ticarət MMC" (invented name) |
| Invented employment | `invented_employment` gate: "<employer>-da işləmişəm/çalışıram…" when no confirmed evidence mentions that employer (a wish like "…-da işləməyi arzulayıram" passes) | brief: employer-name exceptions must not allow invented employment |
| Person | `third_person_verb` (sentence ends in -ıb/-ib/-ub/-üb in a first-person letter, nouns such as sahib/qalib/tərtib/cənub excluded); CV `incomplete_verb` (bullet ends in a bare -mış/-miş) | baseline letters ended "təhsil alıb", "kömək edib"; a CV bullet ended "…bağlamış" |
| Word-existence guard (over-broad rejections) | morphology: negative aorist (olmaz), obligation (-malı), "without doing" (etmədən/etməzdən), -arkən, -dıqca, -duqda, conditional (düşürsə), "-dənsə", imperative; consonant change ğ/q, c/ç; productive verbs from nouns (-laş/-ləş/-laşdır…); about 100 hand-written everyday words; a plain "e" in an ending (Turkish spelling: "etmeyim", "evler") is now refused | on 39 gold Azerbaijani letters of the founder package (reference only) the guard refused 154 tokens (166 distinct), now 25; wrong forms (məshələtçi, məşğülələr, bütlər, gündelik, qurdi…) are still refused (`az-words-forms.spec.ts` pins both directions) |
| Follow-up question | new review note `uncovered_requirement`: vacancy requirement lines that nothing the candidate confirmed speaks to (max 2); the letter never claims them; web label and action text added | brief: evidence selection / follow-up questions |

Tests: tailor suites 314+ pass (new: az-acronyms, az-gaps, az-words-forms, gate cases in az-rewrite/az-writer specs); API and web typecheck clean at last run.

## Findings that matter for tomorrow
* **Provider rate limiting distorts any concurrent run.** The first baseline (concurrency 3) got HTTP 429 on 61 of 115 requests, so only 15 of 42 jobs "accepted" — that number is NOT a baseline. Run sequentially (concurrency 1), as production does. The sequential rerun was stopped at 10 of 42 jobs by instruction (partial file kept privately).
* `moonshotai/kimi-k3` (the configured writer fallback) answered "unavailable" in every case seen: the fallback model may not be reachable at all. Probe it (1 request) and pick a working alternative for the one allowed model comparison.
* CV bullets are converted to third person ("kömək edir"); a mixed-person set falls back to the candidate's own wording by design.
* Several remaining gold-letter "unknown" words are genuinely wrong or foreign in the gold text itself ("geliştirici", "false-positive", "ında"): the package's AI-written letters are not a clean standard.

## Evaluation design (pre-registered, files private under `~/aise-preview/writer-quality-2026-10-11/`)
* **Dev** (tuning allowed): 12 AISE-schema personas (5 earlier + 7 canary AZ) + 18 package-derived direct-evidence cases (6 validation + 12 random train, seed 20261011).
* **Frozen test** (never tuned on, run once per configuration after freezing): 9 AZ package held-out/adversarial inputs + 12 fresh synthetic personas written before tuning. Hashes:
  `frozen-personas.json` sha256 `4b6c7016b2ea56ecb8e78c27f9dd1f31a49bbf194aa3438c49f998479385185d`,
  `frozen-direct.json` `597883d9ee389c38712fda23f251405e40800e6e822befa669d8eaba41949250`,
  `dev-personas.json` `1816955bfab7efe2bf10b2d332403bd4eb764abcd339b1c942f25ba054a051db`,
  `dev-direct.json` `bfeb65f91151bc68f31e3d0c81451b1be4fb82590361618f7a230b513f88759a`.
* Driver `driver.js` + `host-run.sh` run the REAL `writeAzerbaijaniLetter` / `polishCvWording` of the compiled API in a throwaway container of the production image (no DB, queue or e-mail; key read from the host env file into a mode-600 temp file, never printed). Baseline = the image's own code; tuned = `dist.tar` overlay (`USE_DIST=1`).
* Package data hygiene: held-out inputs are not used to tune; contrastive pairs and legacy letters are unused; AI preference labels are not treated as recruiter judgement; gold letters were used only to measure the guards' false rejections, no text is copied into code or prompts.

## Next steps
1. Probe `kimi-k3` and one alternative model (1–2 requests each). 2. Rerun the sequential baseline on dev (production image). 3. Tune on dev with `TAILOR_AZ_WRITER_TRACE_DETAIL=true` to see which gate rejects what (unknown_word, inflated_claim and unavailable were the top causes). 4. Evidence selection (top-3 focus), fallback frames (less templated, no verbatim requirement quote) — not started. 5. One model comparison with full accounting. 6. Freeze, run the frozen test once per configuration. 7. Anonymous before/after pack (PDFs + text + separate key + scoring form), human review marked pending. 8. PR, exact-head CI, deploy behind existing flags.

## Housekeeping
The private employer-plans stack is stopped, the sandbox relay webhook is disabled, no evaluation container is running on the host, and the host temp key directory is gone. Private DB `aise_employer_verify_20261011` and the `~/aise-preview/employer-plans-2026-10-11/` evidence directory are kept for the report.


## Update (11 October, later): dev results and the frozen-test pre-registration
**Dev set, paired, sequential, provider 429s absorbed by the harness (every attempt counted)** — 30 letters (12 personas + 18 package-derived) and 12 CV sets, production image code vs tuned code, same writer model (nemotron-3-ultra), same inputs:

| | baseline (image `6ecdcad`) | tuned (`dist-A4`) |
|---|---|---|
| Letters written by the writer and accepted | 13 / 30 (43 %) | 20 / 30 (67 %) |
| Mechanical defects inside the ACCEPTED letters (wrong ending after an abbreviation, third-person verb, non-Azerbaijani spelling) | 7 | 0 |
| Fact-checker rejections | 6 | 1 |
| CV sets polished | 12 / 12 | 12 / 12 |
| Provider requests / letter, seconds / letter | 2.3 calls, 32 s | 2.2 calls, 28 s |
Caveats: the dev set was used to tune; temperature was lowered at the same time as the gates changed (not separable); provider 429s were 56–63 % of raw requests in both runs (shared, noisy capacity) and the harness retried them; defect detectors are the same mechanical gates, so "0 defects" means "none the gates can see" — not natural Azerbaijani.

**What changed since the checkpoint:** low sampling temperature (default 0.3, `TAILOR_AZ_WRITER_TEMPERATURE`; the model's default sampling produced CJK/Cyrillic characters and garbled words) and two polite 429 retries; prompt rules (first person, abbreviation endings, no hyphen joins, no "Mən" opening); deterministic repair of sentence-final third-person perfects ("alıb" → "almışam"); the fact-checker's quote of the application sentence itself is a false alarm (6 of 30 letters had been lost to it); a gate for "orta" glued to a number; composed fallback letter: weaker keyword matches are no longer presented as an answer to a requirement, projects/certificates/activities count when there is no job, "Bu, <position> üçün elandakı …" replaced by "Elandakı «…» tələbi ilə bağlı təcrübəm: …", certificates are "keçdiyim təlim" or "sertifikatım", never experience.

**Model facts (probes):** `moonshotai/kimi-k3` (the configured fallback) did not answer within 60 s on a one-line prompt; `kimi-k2.6`, `mistral-large-2-instruct`, `llama-3.1-nemotron-ultra-253b` return 404; `deepseek-v4.1-flash` and `gemma-4-31b-it` time out; answering models: nemotron-3-ultra (≈1 s), nemotron-3-super-120b, nemotron-3.5-lightning, glm-5.3(-flash), gpt-oss-20b (these four emit reasoning text unless thinking is switched off).

### Pre-registered frozen-test criteria (written before the frozen run)
Inputs: `frozen-personas.json` (12) + `frozen-direct.json` (9), hashes above, never used for tuning. Both configurations run once, product path (`generateLetter` / `generate`, writer on), same inputs, sequential, 429 absorbed.
1. **Safety (must hold):** 0 delivered letters or CVs with an invented number, name, employer or employment (mechanical gates + engineer read of every delivered text against its facts); 0 PDF compile failures.
2. **Mechanical quality:** tuned delivered texts contain no more of the listed defects than baseline (target 0).
3. **Acceptance:** share of letters actually written by the writer (not the composed fallback) not lower than baseline.
4. **Cost:** provider calls and tokens per document reported in full (writer + checker + ranking + retries).
5. **Human gate (pending, not claimed):** ≥ 4/5 naturalness and relevance and a clear preference with a stated sample size, from native readers using the anonymous pack; until then the status stays "mechanical improvement, human review pending".


## Frozen test, run once per configuration (11 October) — result: mechanical defects down, **safety criterion NOT met**
Commit `43803988…` (dist sha256 `b1efd996…`), inputs `frozen-personas.json` (12) + `frozen-direct.json` (9), product path (`generateLetter` / `generate`, writer on), sequential, 429 absorbed. Baseline = production image `6ecdcad` with its default config (ultra, then kimi-k3); tuned = frozen commit, default config. One harness difference from production: `NIM_MODEL` was not passed, so the ranking model was the code default `openai/gpt-oss-120b`, which answers HTTP 410 — ranking fell back to the deterministic order in BOTH runs (23 and 20 such calls). Production sets `NIM_MODEL`; the default was fixed afterwards.

| | baseline | tuned |
|---|---|---|
| Letters written by the writer (not the composed fallback) | 9 / 21 (43 %) | 12 / 21 (57 %) |
| CV sets polished | 10 / 12 | 11 / 12 |
| PDFs compiled | 33 / 33 | 33 / 33 |
| Provider calls per letter / seconds per letter | 3.2 / 46 s | 2.6 / 17 s |
| Delivered letters with a wrong ending after an abbreviation | 3 | 0 |
| Delivered letters with a third-person verb | 6 | 4 (all in composed fallbacks that copy the candidate's third-person evidence; none in written letters) |
| Delivered letters with a name not in the facts | 2 | 1 (a candidate's own un-diacritized word) |
| Tokens (letters, prompt+completion) | 36.6k + 5.8k | 44.4k + 6.0k |

**Engineer read of every delivered letter against its facts (not a native reader):**
* **Tuned, written, material fabrication — 2 letters.** `pkgfrozen-0` (credential-safety case): the letter says the candidate "explained account-recovery steps … followed identity-verification rules … opened tickets" — the *vacancy's duties* attributed to a student-helpdesk volunteer. `pkgfrozen-4` (near match): "…qeyd edib, müvafiq tədbirlər görülməsini təmin etdim" — an added responsibility that no fact states. Both passed the gates and the fact-checker.
* **Baseline, written:** `pkgfrozen-0` has the same vacancy-duty attribution in the passive ("…izah etməyim … tələb olundu"); `pkgfrozen-2` contains a garbled clause ("rəhbərliyini keçirib").
* Tuned also: "…səlahiyyəti olmamışam" (my third-person repair produced an ungrammatical form from "olmayıb"); "ayda təxminən 120 səhifə həll edirəm" (translate → solve); "TOEFL … səlis biliklərimi təsdiq etdim" (interpretation of a score). The checker passed all three.
* Composed fallback (both): lists a *lack* as an example ("Təcrübəmdən nümunələr: Satış və CRM təcrübəsi yoxdur"). The prompt-injection cases were ignored by both (no invented years, diploma or certificate).

**Therefore:** the pre-registered criterion "0 material fabrication" is **not met** for the tuned configuration (nor for the baseline). The improvement is real on the mechanical defects, acceptance and latency, but the writer can still embellish when the facts are thin, and the fact-checker model does not catch it.

### What was changed after seeing this (post-freeze, so NOT part of the frozen result)
1. The vacancy's requirement lines are no longer sent to the writer (it attributed duties to the candidate); rule (2) now says a job description is not a source of facts.
2. New deterministic gate `unsupported_clause`: a sentence made mostly (≥ 40 %, ≥ 3 stems) of words that nothing confirmed contains is rejected. On the 216 delivered sentences of all runs it flags 9, among them both fabrications above and the dev embellishments `pkgdev-8/9/15` that the earlier "0 defects" claim missed (the dev table above is therefore too optimistic: 3 of the 20 accepted dev letters contained an embellished sentence).
3. The third-person repair no longer touches "ol-" and negative forms (those drafts are rejected and rewritten).
4. The composed fallback never lists a negated statement as an example.
5. Code default of the ranking model is now the live `nvidia/nemotron-3-super-120b-a12b`.
Because the frozen set is consumed, these are checked on a **new pre-registered set** (`frozen2-direct.json`, sha256 `ab2bf30d…`, 12 cases written before the fix was run) plus a replay of the consumed set (information only).


## Final evaluation record (11 October, evaluation chain completed; every case run to completion, 0 harness errors)
Code under test: branch `codex/writer-quality-20261011` at the frozen checkpoint (this document's commit adds only text). Provider requests recorded in the evaluation files: **1,569** (850 HTTP 200, 591 rate-limited 429, 62 other — 43 of them HTTP 410 from the retired default ranking model, 19 5xx); about 60 further requests were availability probes; the first partial runs are included. The ≤40-request budget of the earlier hour no longer applied to this brief; nothing was repeated once a run completed (the only stopped run was the first sequential baseline, kept as a partial file and superseded).

**What was measured, and what is comparable.** Provider capacity changed hour by hour (429 on 25 % → 70 % → 0 % of requests), so only runs made inside one chain are paired. The harness re-sends a 429 (up to 10 times); every attempt is counted.

| Evaluation (all complete) | inputs | baseline (production image) | final code |
|---|---|---|---|
| Fresh pre-registered set, product path (`frozen2-direct`, sha `ab2bf30d…`, written before the fixes were run) | 12 letters | writer-written **6/12**; mechanical defects in written letters **5** (3 third-person verbs, 1 unsupported clause, 1 wrong ending); engineer read: **1 invented activity** ("qonaqların qeydiyyatını və informasiya dəstəyini aparmışam") | written **6/12**; defects **0**; engineer read: **0 invented facts**, 1 mild embellishment ("əsas məlumatların qeydiyyatını aparıram"), 1 wrong ending on a name ("Holding-da") |
| Replay of the consumed frozen set with the final code (information only, not independent) | 21 letters, 12 CV sets | written **9/21**, defects in written **9**, CV **10/12** | written **11/21**, defects **0**, CV **10/12**; the two fabrications of the frozen run are gone (those two letters now fall back to the composed text) |
| Dev set, final code (tuned on it, so optimistic) | 30 letters, 12 CV sets | 13/30 in a 56 % rate-limited hour | 24/30 written, defects 0, CV 12/12 (unthrottled hour: not comparable with the baseline column) |
| Latency per letter (seconds) | | 46 (frozen) / 36 (fresh) | 24 (replay) / 12 (fresh) |
| PDFs compiled (all product-path runs: 33 + 33 + 12 + 12 + 42 + 33) | 165 | all | all |

**Language errors still visible in delivered text (the mechanical gates cannot see them):** case endings after a non-abbreviation foreign name ("Azərsun Holding-da", "Sənaye Kolleci-də"), third-person verbs copied by the *composed fallback* from third-person evidence ("…kömək edib"), grammatical slips such as "rəhbərliyi etmişəm", wrong verbs ("tərcümə → həll") that were seen in the pre-fix frozen run, and every question of naturalness. **No native reader has reviewed any of this.**

**Fallbacks.** About half of the letters in every configuration fall back to the composed text (provider unavailability, a rejected draft, or thin facts). The fallback is labelled in the product (`writer_fallback`); its wording is the candidate's own plus fixed frames.

**Model comparison (one alternative, same dev inputs, full accounting):** `nvidia/nemotron-3-super-120b-a12b` as the writer (checker unchanged): 3/30 letters accepted (10 %) at ≈4 s/letter, 7/12 CV sets, 82 requests with almost no 429 (a separate capacity pool) — rejected as writer. The configured second model `moonshotai/kimi-k3` did not answer within 60 s; it is no longer in the default chain.

**Status:** *mechanical improvement demonstrated on a fresh set and on dev; safety improved (fewer unsupported statements reach the page than before); human naturalness/relevance gate PENDING.* The anonymous before/after pack (44 items: 33 letters + 11 CV bullet sets, PDFs + text + scoring form, key kept separately, 5 pairs identical) is at `~/aise-preview/writer-quality-2026-10-11/review-pack-2026-10-11.zip`.
