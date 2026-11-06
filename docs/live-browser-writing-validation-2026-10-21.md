# Live browser and document-writer validation — 21 October 2026

This is validation and implementation evidence, not a deployment record. The new fixes extend PR #105. No real employer application, payment or identity-document upload was performed.

## Glorri

Ran the actual identity-filling helper against live XalqBank and AYNA Glorri forms using synthetic names, an example.invalid email and a synthetic Azerbaijani phone number. This exercised the live portal JavaScript through a developer browser session, not a newly installed and paired production extension.

Found a real defect: the portal prepopulates a phone-mask scaffold, which the helper mistook for an existing candidate-entered number. It filled the name/email fields but skipped the phone. The fix permits empty mask scaffolding and a country prefix alone, while preserving actual and partially entered numbers.

After the fix, the phone visibly rendered as +994 50 123 45 67. “Davam et” retained the synthetic identity fields and flagged other required fields. Testing stopped rather than inventing identity details or attaching documents. AYNA also accepted the four basic identity fields. Landau required a CV and identity-card image; no such uploads were attempted.

The extension manifest is bumped to 0.3.4. Saved-form browser regressions: 6/6 passed, including blank masks, country-prefix-only masks and preservation of partial candidate numbers. Live letter-step persistence, attachment upload and final submission remain unverified.

## Actual provider writing evaluation

Used the production generation service and configured providers, with fictional candidates and employers only. Evaluations ran in isolated Node processes without database, application queue, entitlement or email writes. Patched modules were loaded only in evaluation-process memory, not written into production containers.

Baseline: 10 actual provider requests, 18,650 reported tokens. Three generation attempts covered BI/payments, audit/student and backend engineering. The last attempt exhausted the evaluation request budget; its unavailable result is censored and is not evidence of a provider outage. All actual HTTP requests returned 200.

The baseline exposed avoidable rejection causes: renamed answer metadata IDs, changed numeric spellings and weak use of vacancy context. The fixes provide exact permitted IDs, numeric spellings, separated vacancy context and mentorship scope. The writer now receives source-record identities so different roles/projects are not implicitly combined.

Initial patched comparison: 10 requests, 18,339 reported tokens. The three cases reached mechanically accepted writer output in about 3.4, 11.6 and 14.5 seconds. Manual review found that the audit output omitted a confirmed contribution despite its positive fact-checker result. This was not counted as editorial success.

Added semantic answer-coverage checking to the fact-checker contract. Missing or malformed coverage results fall back rather than being represented as a complete letter. Missing confirmed answers trigger bounded revision with explicit feedback. The deterministic fallback describes mentorship as programme participation rather than employment.

A focused audit rerun used 2 requests / 3,510 reported tokens and completed in 2.3 seconds with all four candidate-answer meanings present. Manual review still identified a sentence implying that separate source projects were stages of one project. Added explicit source_id boundaries to writer/checker inputs and instructions, with regression coverage for distinct same-employer roles and projects. A positive model judge is not editorial certification or proof that every factual relationship is correct.

Evidence files, synthetic inputs and actual provider outputs are retained outside Git in the private aise-preview/live-validation-20261021 directory. These small samples establish observed behavior, not recruiter preference, a hiring uplift or universal language quality.

## LinkedIn

HRX advertises LinkedIn URL import. Its public-profile test failed in this session, but the founder reports their own profile imported successfully last week. That report is not invalidated by this test.

A bounded Jina Reader public-profile probe returned HTML with the exact requested Person identity. AISE's existing parser recovered Bill Gates's name, headline, three roles and two schools. The default reader Markdown had an article title; raw HTML and exact identity verification are necessary. This is evidence for an optional reader fallback, not universal LinkedIn access. No private candidate profile was sent in this evaluation.

References: https://hrx.az/cv-hazirlamaq and https://github.com/jina-ai/reader.

## Verification

- Full API before the final source-identity addition: 128 suites / 1,997 tests passed.
- Final affected writer/composer/service suites: 3 suites / 131 tests passed.
- Dedicated PDF render: 2 suites / 14 tests passed.
- API build passed.
- Saved Glorri browser tests: 6/6 passed.
- Existing PR #105 web checks are documented separately in candidate-readiness-2026-10-21.md. No web source changed in this validation increment.

No release controller or production configuration change was started. Deployment remains a separate handoff.
