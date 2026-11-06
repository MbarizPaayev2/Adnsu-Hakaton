# Candidate readiness and checkout recovery — 21 October 2026

Base: production/main `7b5367813dabe38b4995596bee9e1231487ae119`.
Branch: `codex/candidate-readiness-checkout`. This report is implementation and verification evidence, not a deployment record.

## Concrete changes

- The main motivation-letter editor now displays full, editable proposals for role interest, company interest, relevant experience and contribution. Previously the newer suggestions appeared only in a separate preparation screen. Each sentence needs explicit candidate adoption; existing answers are not overwritten silently. Confirmed text is passed through the existing document-generation request. Changing vacancies resets proposal state and discards stale responses. Manual answers remain available if guidance fails. The endpoint supplies Azerbaijani proposals without adding provider/model calls.
- Guidance uses the actual target role and company, requirement-linked skills and relevant individual sentences from source evidence. It does not invent employer culture or candidate achievements. These deterministic proposals are starting points for candidate review, not evidence of recruiter preference or native editorial quality.
- Reconciliation accepts the exact deterministic target-role headline instead of rejecting it as an unfamiliar candidate qualification and restoring the base-profile headline. Arbitrary model-invented credentials are still rejected. Summary evidence selection now considers later sentences within a source highlight instead of only its opening sentence. Final CV employer labels are cleaned without editing canonical profile records; SAS is classified as a technical tool.
- Email-agent settings now have a permanent dashboard navigation entry. A failed dashboard status request no longer hides all agent links. Unavailable services are labelled unavailable. Plan entitlements, sending consent, dispatch behaviour, prices and quotas are unchanged.
- LinkedIn handling no longer treats an otherwise valid profile redirect containing `trkInfo` as an authwall. HTTP 401/403 join 429/999 in actionable PDF/text fallback handling. The UI no longer promises all public profiles can be fetched by URL. Existing URL/identity/SSRF guards remain.

## Checkout finding and fix

Read-only Safari validation reproduced the reported production behaviour: pricing → Premium by client navigation left a blank embedded frame with a wallet warning and indefinite loading. One refresh loaded the provider's contact/address form. No financial details were entered and no payment was attempted.

The code has route-specific CSP: pricing excludes Dodo frames/scripts, while checkout permits them. A client transition does not replace the existing document policy. Paid-plan entry points now use native document links so the checkout response policy is applied before provider initialization. Employer billing entry points receive the same treatment; checkout exits restore destination document policy instead of retaining checkout permissions. Policies themselves were not widened.

Session creation and SDK import have bounded deadlines; a frame that never reports readiness leaves the loading state after 15 seconds and exposes retry/hosted checkout. A wallet-only failure does not discard an already usable card form. Delayed cleanup cannot close a newer checkout owned by the same component. Payment events still do not activate entitlements; existing API/webhook verification is unchanged.

The patched checkout has not yet been validated against the live provider after deployment. The live reproduction validates the before behaviour and supports the CSP diagnosis, not a completed production fix.

## Verification

- Full API: 128 suites / 1,992 tests passed after source changes; a final additional matching-guidance regression was also run separately.
- Full web: 96 files / 612 tests passed. After the final proposal state-reset refactor, the four affected component suites passed (54 tests).
- Dedicated PDF suite: 2 suites / 14 tests passed.
- API build and web TypeScript check passed.
- New proposal component, its tests and the pricing regression lint clean. A wider changed-file lint run still reports existing lint debt in legacy components; it is not represented as a clean repository lint run.
- Real Chromium + compiled API + isolated Postgres extension integration: 6/6 passed (pairing/auth, entitlement enforcement, approval, local fixture submission, quotas, downgrade/expiry/revocation). The temporary named database was dropped after tests.
- Real Chromium + saved, stripped Glorri form fixtures: 5/5 passed (identity, phone, approved-letter filling, preserving edits, excluding referee and experience fields; no uploads/submissions). The extension test command now packs its private archive before the API starts, matching the release image's packaging order.

## What remains unverified or constrained

1. LinkedIn can still block automated server access, even to a public profile. No authwall bypass, user cookies, paid scraper or broader fetch permissions were introduced. PDF/text import is the dependable fallback.
2. Follow-up live Glorri testing found and fixed a phone-mask defect and verified basic identity persistence after “Davam et”. Later steps and final submission remain unverified; see live-browser-writing-validation-2026-10-21.md. No real employer application was sent.
3. Production email and email-automation feature flags were enabled during the read-only check. The inspected candidate dashboard showed Plus; background preparation is Premium-gated, while manual email applications have their own allowance. No personal automation/consent settings were changed.
4. Follow-up bounded live-model evaluations and manual inspection are recorded in live-browser-writing-validation-2026-10-21.md. They exposed answer omission and source-relation issues; positive model verdicts are not editorial certification. English source facts can still require translation/review before use in Azerbaijani proposals.
5. No deployment or release controller was started. Release must use the existing CI/build/backup/restore/verify flow and then check first-visit pricing → checkout without a refresh. Local disk was about 3.4 GiB free at inspection; do not start an image build that requires 6 GiB without freeing safe build artifacts first.

Private candidate PDFs, screenshots, credentials and real payment session identifiers are not included in this change set.
