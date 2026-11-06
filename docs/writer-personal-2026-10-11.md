# Writer round 3: personal explanation letters (11 October 2026)

Status: implemented on `codex/writer-personal-20261011` (stacked on PR #49 → #46); **not deployed; human quality gate pending.** The founder's round-2 feedback was qualitative ("better, but not personal, curious or persuasive enough"), not an approval.

## Changes
* **Letter shape:** a personal explanation, not a CV summary: reason → the experience that made it clear → the strongest experience told with its numbers → the contribution to notice → what caught the candidate's attention. The frame "… tələb olunur; mən …" is refused; requirements are never listed; at most two roles are told; a fact with a measurable result is ranked first (`az-writer.ts`, `az-rewrite.ts`).
* **Four optional answers** (`motivation`, `formative`, `companyReason`, `contribution`) travel as separate fields through DTO → processor → writer and composed fallback; they are the only source of wishes and feelings (checked), and the review shows which were left empty (`reason_missing`).
* **Length:** no fixed brevity; target from evidence and answers up to 240 words or the destination's limit; sparse evidence stays short.
* **Composed fallback:** connected sentences with code-written dates, answers placed in the story rather than appended, qualification only when the vacancy asks, no quoted requirements (`az-letter-compose.ts`).
* **Form:** four questions with short answer options (Azerbaijani letters), free text always available; an unfinished sentence start is not sent (`motivation-letter-composer.tsx`).

## Evidence
Three representative cases plus one comparison, shown with facts and answers in `third-review-batch-2026-10-11.zip` (outside Git): sparse without answers, the same candidate with answers, an experienced candidate with achievements. 1,531 API and 410 web unit tests pass. No outcome (interviews) is claimed or measured.

## Known weaknesses
Writer versions can repeat a thought or add a mild adjective not in the candidate's words; many letters will still come from the composed version; no native-reader review.
