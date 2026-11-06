# Task-first document quality — 23 October 2026

## Problem and resulting behavior

A sales application could lead with an unrelated machine-learning metric because generic words and short-token overlap counted as evidence relevance. The preparation sheet then proposed three versions of the same office-tool motivation. A separate loose matcher could reintroduce unrelated skills in the headline even after the skills section excluded them. Reconciliation could undo role ordering, and spoken languages could appear twice in the rendered PDF.

This increment:

- Parses section boundaries in mixed imported posting descriptions, including inline AZ/EN/RU headings. Responsibilities, requirements and benefits remain distinct. Keeps all parsed work/qualification lines rather than truncating analysis to eight/six rows.
- Ranks source evidence by substantive target-role, task and qualification terms. Numbers add only a small tie-breaker after relevant work is established; employer prestige earns no bonus. Practical work outranks an equivalent certificate heading.
- Applies task ranking to letter evidence, CV highlights, role selection/order, projects, activities, certifications and awards. In a concise résumé, unrelated roles get at most one bullet. Role identities remain stable and base-profile data remains unchanged.
- Uses the same vacancy-selected skills for headline and document body. Rejects compound skills connected by only one generic fragment. Removes basic office-tool padding and repeated title terms from headlines; groups Outlook/Word as tools.
- Prepares editable motivation suggestions from stated work rather than the first office skill. A company name and tool alone no longer manufacture a company-specific reason. All suggestions still require candidate adoption; no personality, company culture, hiring odds or years of experience are invented.
- Avoids copying an adopted experience fact into the letter body again. Identifies explicitly named mentorship programmes even if the role title omits “mentee”.
- Renders spoken languages in their own PDF section once, retaining explicit fluency and legacy skill-only languages. Programming-language groups remain skills.

## Evidence and limits

Synthetic regressions cover a sales/ML pivot, irrelevant large metrics, benefit leakage, MS Office fragment leakage, complete long postings, multilingual/inline headings, short-fact deduplication, programme scope, final role-order reconciliation, office-tool headlines and separate language rendering. A grouping fixture was changed to explicitly request reporting, and an old letter fixture no longer requires unrelated previous work to be copied. Original index-validation, dates, scope, fact-preservation and PDF tests remain in place.

A synthetic candidate was run through the actual public CV and letter generation methods with suggested answers *simulated as adopted*, external networking disabled and **zero provider requests attempted**. Both PDFs were rendered and visually inspected. This proves the deterministic generation and rendering path; it is not live-model persuasive-quality evidence or a real candidate approval/send.

No plan quotas, payment settings, sending permissions, provider credentials or database schema changed. No employer email was sent. Founder documents were reviewed privately and were not committed.

## Remaining development and release work

1. Evaluate live model writing on a small, diverse AZ/EN role set with human language review. Measure factuality, relevance, repetition, readability, rate limits and cost separately; do not equate unit-test totals with writing quality.
2. Validate one explicitly approved email application to a controlled recipient: document snapshot, subject, candidate identity/reply route, provider acceptance/delivery, tracker state and retry behavior. Supported-email discovery already exists; this increment does not certify live delivery.
3. Validate Glorri assistance on live forms without submitting employer applications: phone masks, multi-step persistence, approved-letter insertion, referee exclusion and CAPTCHA/login handoff. Do not label form filling as autonomous submission.
4. Independently review the separate company-following PR #111 and translation/review/PDF-text PR #112, then integrate exact green heads in one release. This branch also touches rendering preparation and must be reconciled with #112.
5. Telegram PR #108 remains separate with consent, quiet-hours and delivery-retry findings. Institutions PR #107 stays deferred pending demand; the public institution-interest page is already released.

Production SSH was unreachable from the Mac during this increment; the public homepage returned HTTP 200. No new deployment was attempted.

## Final validation

- API: **131 suites, 2,032 tests passed**.
- PDF: **2 suites, 14 tests passed**.
- API TypeScript/Nest build passed; `git diff --check` clean.
- Synthetic public-generation run: zero external requests; revised CV and letter compiled and visually inspected as one-page documents. The résumé headline, final experience order, projects/awards and single languages section were checked in rendered output.
- Web source and API response shape are unchanged; no web suite rerun claimed.
