# Browser assistant and application routes: capability matrix (16 October 2026)

Read from the code at `main` 26bba5c (PRs #69/#70) and the existing evidence documents. "Fixture" means a local copy of a page or a test double; it is not acceptance by a real employer.

| Capability | Status | Evidence | Limits |
|---|---|---|---|
| Email application (candidate approves each one) | Supported | Real-database integration tests; one synthetic message accepted by Resend's test address (`docs/candidate-workflow-2026-10-15.md`) | Only where the employer published an application address. Provider acceptance is not inbox placement. |
| Premium email automation (opt-in) | Supported, behind `EMAIL_APPLY_AUTOMATION_ENABLED` | Same suite: consent version, caps, stop conditions, aliases | Stops on unknown location, extra requirements, revoked consent, downgrade, changed instructions. Enabled only after the current release is verified. |
| Install and pairing (Chrome/Edge desktop) | Supported | ZIP download requires current Premium (401/403 tests); pairing code is single-use, 10 minutes | Unpacked install with Developer mode; not in the Chrome Web Store. No mobile browsers. |
| Premium enforcement server-side | Supported | `browserAccess` checked for the ZIP, pairing, consent creation, work hand-out, assisted profile and submission permit; downgrade ends open work | Monthly cap from the plan entitlement. |
| Identity help on Glorri and other employer forms | Partial | Extension 0.3.0 fixtures; real-page reading only | Fills only blank name, email and phone in the active HTTPS tab. No file upload, questions, declarations, consent clicks or submission. Not an application. |
| Approved submission on Lever | Partial | Real page read and fixtures; full flow against the local API | Live submission to a real employer has not been exercised (`UNVERIFIED`). hCaptcha is always the candidate's. Employer questions not covered by approved answers go to the candidate. |
| Other portals (Workable, Teamtailor, SuccessFactors, Glorri apply) | Unsupported | — | A vacancy link that does not match a reviewed adapter is not offered for submission. |
| AI interpretation of unknown fields | Unsupported | Field resolution is deterministic (`field-resolver.ts`) | If added later, it may only map a field to a verified profile fact or ask the candidate; page text is never treated as instructions. |
| Autonomous browser submission | Unsupported (off) | Campaign mode exists in code, autonomous availability is false for every portal | Not offered to candidates. |
| CAPTCHA, login walls, access controls | Never bypassed | Design and tests stop with a reason | The candidate completes them. |
| Recovery after failure | Supported | Lease/heartbeat, blocked reasons and the application timeline | Explanation shown per application; the candidate can retry or apply manually. |

Unverified until there is real-employer evidence: any claim that an application submitted through the assistant was received by the employer.
