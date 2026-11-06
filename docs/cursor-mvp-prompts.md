# AISE — Cursor prompts for the 5 October 2026 MVP

## How to use this pack

Open the **root** AISE repository in Cursor: `/Users/fizuli.050icloud.com/Desktop/aise`. Do not open the nested `aise-main/aise-main` copy. The screenshot showed Cursor event credits, not GroqCloud API credit; these prompts are for coding work. Credits do not pay the application's server or production AI API bill, and their balance is not a guarantee that every task below will fit.

Run one numbered task at a time. Start with the shared instruction and Prompt 1. Review the resulting diff and evidence before proceeding. A new task can read the shared instruction and its numbered prompt from this file. Do not repeatedly ask for a complete repository audit or run multiple agents against the same checkout.

Read `docs/mvp-2026-10-05-audit.md` for the inspected baseline and its limits. Existing admin access for `ceo@aisehr.com` has been provisioned separately; never include its password in prompts.

Suggested deadline: core access, founder role and job/CV fixes by 30 September; external fixture tests and a recipient-approved pilot by 2 October; final UI, release verification and a go/no-go decision by 4 October. Escalate a missed dependency early rather than silently removing a required journey.

## Shared instruction — include with every task

```text
You are implementing a bounded launch task in the existing AISE repository, targeting 5 October 2026. Read docs/mvp-2026-10-05-audit.md and the numbered task I name in docs/cursor-mvp-prompts.md. Implement and verify that task, rather than returning only a plan.

Before editing, inspect git status, branch, HEAD and relevant diffs. Fetch origin if available and preserve teammates' and untracked work. Work from current integrated code on a codex/ branch; do not reset, clean, overwrite or rewrite unrelated work. Use the root apps/ tree, not aise-main/aise-main. Read applicable AGENTS.md, including the installed Next.js documentation required by apps/web/AGENTS.md for frontend changes. Reconfirm the target findings against current code; do not repeat a broad audit.

Keep Next.js, NestJS, Prisma/Postgres, BullMQ/Redis, the CPU matching service and the existing apply worker. Avoid rebranding, a rewrite, custom model training, GPU purchases and unnecessary providers. Use existing components and libraries. Keep customer-facing copy in clear Azerbaijani, with English only where intended.

Use isolated test accounts/data and a mail sink or test provider for automated checks. Never print credentials, tokens, CV contents or identity images in logs, screenshots, commits or reports. Do not copy production data into a coding service. Use environment variable names and synthetic fixtures. No real payments, external employer applications, bulk messages, production deletion or production feature activation as an incidental test. Prepare those checks for a named authorized destination and explicit candidate confirmation.

Test business outcomes and failure modes, including server-side authorization, not just rendering or mocked method calls. Keep tests proportionate to the change. Use migrations for durable schema changes; do not use db push/reset against production. Update shared types and all consumers together. Builds must not rely on ignored type errors or disabled security checks.

Finish with: changed files, behavior before/after, exact checks and results, migration/configuration needs, remaining external blockers and a small reviewable commit. Update docs/mvp-progress.md with the task, SHA, evidence, and PASS/FAIL/BLOCKED/NOT RUN. Do not call a journey end to end when email, UI, payment or receipt was bypassed. Do not deploy or merge just because tests passed; leave the implementation reviewable for the release task.
```

## Prompt 1 — Candidate and employer journey, including real email behavior

```text
Implement the core candidate-to-employer journey and close its remaining failures. Focus on apps/api/src/auth, business auth, common/email.service.ts, profiles, resumes, job-applications, notifications, and their web screens. Reuse the working native-application implementation rather than rebuilding it.

Fix EmailService so provider error responses and thrown failures are handled explicitly. Do not return a successful-send result after a failure. Preserve generic anti-enumeration responses where appropriate, while recording delivery failures and offering a bounded retry. Make mock delivery explicit in non-production; fail safely on missing production configuration. Fix candidate register handleResend, which currently labels the attempt sent in finally without checking res.ok. Check equivalent business and password-recovery paths.

Demonstrate: candidate signup -> email in test mailbox -> verification -> login -> CV upload -> editable extraction review -> saved profile -> active job match -> tailored CV download -> native application with a required attachment. Then demonstrate employer signup -> verification -> founder approval through the actual admin API/UI -> vacancy publication -> received application/attachment -> status update -> candidate sees the update. Cover reload/resume and session expiry. A completed application must not be duplicated by double-click or retry.

Use scripts/smoke-e2e.sh as a starting point, but add browser-level coverage for the actual forms. Do not claim its direct DB token lookup, approval or test entitlement proves those real journeys. Test expired verification links, failed resend, invalid/oversized/unsupported CVs, extraction with missing fields, and cross-user/employer access denial. Keep unsupported documents actionable rather than inventing profile facts.

Record the exact paths tested, fixture boundaries, mail delivery evidence and any remaining live-provider check. A screenshot of a success page alone is insufficient evidence of employer receipt.
```

## Prompt 2 — Founder super-admin identity and secure account management

```text
Extend the existing AdminUser/AdminSession system into founder-controlled administration. The designated founder email is ceo@aisehr.com. A current administrator account has already been created for that address; inspect before provisioning anything and preserve that identity and its audit history. Do not create a second account, ask for its password in chat, or change its password incidentally.

Inspect apps/api/src/admin, scripts/create-admin.ts, Prisma AdminUser/AdminSession/AdminAuditLog, and apps/web/src/app/admin plus its cookie proxy. Add explicit SUPER_ADMIN, ADMIN and read-only SUPPORT permissions with a server-enforced matrix. Only a trusted bootstrap/migration step may designate the known founder; never elevate every existing admin or infer privilege merely from a client-supplied email. Ordinary candidates/employers cannot become admins. Existing unknown operators should not gain founder permissions.

Provide website flows for changing one's own password, revoking sessions, and inviting/disabling scoped operators. Only SUPER_ADMIN can grant/revoke administrator roles. Use expiring, single-use account setup/recovery links and verified delivery; no public admin registration or default passwords. Add MFA and a private recovery procedure for founder access using a supported implementation. Do not leak hashes, setup secrets, reset tokens or recovery codes into APIs/logs. Prevent removal or demotion of the last active super-admin and test the concurrent case.

Keep httpOnly/secure session cookies, login throttling and appropriate CSRF/origin protection. Password reset/rotation and disabling an operator must invalidate old sessions. Bootstrap should use a minimal database context, not start every background processor in AppModule. Provide a private interactive recovery command, with no password placed in shell history.

Test candidate/business token rejection, direct API privilege escalation, every role boundary, expired/replayed invitations, revoked sessions, MFA, last-owner protection and recovery. Revoke any obsolete owner sessions only as part of the explicitly authorized account operation. Report what is implemented versus still requiring founder enrollment.
```

## Prompt 3 — A usable founder operations dashboard

```text
Build a practical founder control panel on the existing /admin foundation and permissions from Prompt 2. Every visible action must have a real backend implementation and a verified result. Keep it simple and usable in Azerbaijani on desktop and phone.

Include: overview counts and recent failures; users and entitlement status; employer approval/rejection/suspension; native vacancies and external listings with source/freshness/moderation; native and external application status; matching/CV-generation job failures; import freshness and run history; delivery failures; feature availability; audit log; backup age, last restore test and service health.

For operational actions, support only explicit bounded operations: retry a provably safe failed job, request a deduplicated import, pause an importer, suspend/restore an account or listing, revoke sessions, and pause external application submission. Store feature configuration durably and enforce it on the server/worker, including final submit. Show production/staging clearly. Enabling live auto-apply must retain the separate server safety gate and pilot prerequisites; an admin switch cannot erase receipt/consent requirements. Never retry an application whose delivery is uncertain.

Make plan overrides auditable with a reason and an expiry; distinguish them from paid provider subscriptions. Do not imply a database plan edit changed a payment contract. Link to the payment provider for operations not yet supported. Provide pagination, filters, empty/error/loading states and confirmation for consequential actions.

The current restart page does not deploy code. Correct that wording, show the actual release SHA and measured readiness. The public API currently has a host Docker socket: remove that broad privilege or isolate required fixed operations behind a narrowly scoped internal service. Do not add arbitrary shell, SQL, raw environment editing or secret viewers to the website. Show configuration presence/status with secret values masked.

Audit sensitive actions and sensitive-record access with actor, target, time, reason and safe before/after metadata. Minimize candidate-data exposure; support staff should not browse identity images. Keep audit history across account removal. Prove restricted roles cannot invoke hidden actions directly and that action success reflects backend state.
```

## Prompt 4 — Fresh jobs, useful matches and reliable CV generation

```text
Fix the data-to-match-to-CV journey using the existing source adapters and CPU matching service. Start with apps/api/src/scrapers/glorri/glorri-scraper.service.ts, jobs, matching, resumes/tailor and the matching/resume web pages.

Remove the collector's assumption that encountering one known job means later jobs are known. Handle interleaved/promoted listings, repeated pages, pagination limits, timeouts and rate limits. Deduplicate by stable source identity, update changed listings and reconcile expired/closed jobs. Track source/last-seen/sync outcomes. A partial or failed crawl must never mark all unseen jobs closed. Add bounded scheduling, overlap prevention and modest backoff; do not create an uncontrolled bulk crawl. Use a documented/permitted Glorri feed or existing approved source, and record an owner dependency if permission/access is missing. Add a validated employer-supplied CSV import if useful, with preview, deduplication and source attribution.

Verify that active listings create or refresh relevant matches without duplicate rows, repeated quota charges or notification floods. Exclude closed jobs from new recommendations and new submissions. Handle zero matches and exhausted quotas clearly. Do not use sensitive personal characteristics to score suitability. Keep existing CPU inference; no GPU or custom-model training.

For CV tailoring, make endpoint/model configuration explicit so a production-authorized provider can be selected without hardcoded NVIDIA-only assumptions. Do not assume Cursor credits are API credits. Preserve a working provider until a replacement passes tests. Add validated structured responses, bounded timeouts/retries, usage accounting and per-user limits. Keep errors redacted. A generated CV must preserve candidate facts and never invent employers, dates, qualifications or skills. Candidate reviews before submission.

Test known-then-unseen jobs on the same/later page, duplicate/reordered pages, partial sync, closure/reopening, duplicate queue deliveries, worker outage, provider 429/timeout/malformed output, and failed PDF generation. Use representative synthetic Azerbaijani/English CVs and inspect the generated PDFs. Report cost/latency only from measurements, not guesses.
```

## Prompt 5 — Complete the external application state and consent flow

```text
Complete a candidate-confirmed Glorri application journey across the web, API, Prisma schema, shared types and apply worker. Scope to Glorri. Do not advertise or build unattended mass applications to arbitrary job sites.

Read external-apply.service.ts, its DTOs/types, the worker adapter and sessions services, and dashboard/apply/[id]. The current implementation blocks the privacy checkbox but does not propagate valid authority. Capture and present the recipient's actual privacy notice and destination before transmitting the candidate's documents/data. Record explicit scoped authority with candidate, destination/vacancy, notice version/hash, time and approved fields/documents. Do not treat a generic checkbox answer as authority. Unknown screening answers must be asked of the candidate, not guessed. Request identity documents only if the selected destination actually requires them and explain why.

Implement truthful states for preparation, missing information, review, submission in progress, OTP, confirmed receipt, unconfirmed delivery, failure, cancellation and expiry. Choose compatible names and add proper migrations. Replace the current no-error/no-OTP => SUBMITTED fallback. Only validated destination evidence can mark success; record a safe receipt identifier/evidence reference. Keep an unknown result when the request may have been sent but no receipt is known. Do not claim that cancelling locally withdraws a previously sent application.

Atomically claim submission before contacting the worker so two simultaneous requests cannot send twice. Persist the attempt before the side effect. Enforce consent, ownership, destination allowlist, pilot eligibility, limits and the live gate again at final submit/OTP. Gate-off must stop new sends in sessions already created. Coordinate worker handling of the same attempt id. Do not promise exactly-once external delivery without destination support; preserve uncertainty and require reconciliation after a crash or timeout.

Keep dry-run incapable of sending a real application, including OTP. Final submission remains a deliberate candidate action. Restore the matching-page auto-apply CTA only for genuinely supported/eligible records, driven by server capability. Disabled/unsupported destinations retain a clear assisted-apply route with no false submitted label.

Tests must cover consent absent/changed/revoked, another user's request, two concurrent confirms, timeout after send, repeated attempt id, double-click, cancellation race, expired session, forged status, gate disabled mid-flow and dry-run. Implement the code now; keep live activation pending the controlled receipt test in Prompt 6.
```

## Prompt 6 — Browser worker reliability and recipient receipt proof

```text
Validate the complete external application path implemented in Prompt 5. Create a local controllable ATS fixture and use the real browser worker against it; retain production host allowlisting and ensure test URLs cannot be supplied by an ordinary client. Do not globally weaken URL validation for tests.

Fixture cases: normal form, required questions, changed privacy notice, document upload error, OTP correct/incorrect/expired, visible rejection, delayed response, changed DOM, unexpected navigation, CAPTCHA/manual intervention, ambiguous network outcome and explicit receipt. Dry-run must have a fixture assertion that the final submit handler was never called. Use synthetic documents and accounts.

Fix session capacity reservation before async browser creation, per-application serialization, browser cleanup on every error path, restart reconciliation and TTL behavior. Invalid OTP must not silently destroy the only usable session if the UI offers another attempt. Stop safely at unsupported controls and CAPTCHA; no bypass techniques. Keep secret/PII data out of screenshots/logs where feasible, protect retained evidence and expire it.

Run browser integration tests including double-confirm and process loss around final send. Verify no successful status without receipt, no automatic resend after an uncertain result, no resource leak, and safe behavior with low worker capacity. Record measured concurrent-session memory and latency on the intended host.

Prepare one controlled real Glorri test using a cooperating employer or a documented sandbox. The founder must supply the recipient/test vacancy and authorized candidate/data; contacting Glorri or submitting a real application is not implied by this coding task. Verify current source terms/API options before integration. After the authorized test, record destination, timestamp, redacted receipt and recipient confirmation. Do not fabricate this evidence. If access is missing, finish all fixture-tested implementation, mark only the recipient check BLOCKED, keep live sends gated, and give the founder the exact remaining action.
```

## Prompt 7 — Billing, notifications and account lifecycle

```text
Make the paid-plan lifecycle correct before paid launch. Inspect billing.service.ts, billing tests, quotas, all plan-based feature gates, admin plan overrides, notification processors and candidate/admin deletion flows. Verify provider behavior against current official Dodo documentation.

Keep raw-body signature verification. Add durable webhook deduplication and ordering/reconciliation using trustworthy provider state. Correct plan_changed so the purchased product and entitlement agree. Handle repeated/out-of-order activation, cancellation, renewal, upgrade, downgrade, past-due, pause and expiry without resurrecting a cancelled plan or granting unpaid features. Keep current-period/cancellation semantics aligned with the provider contract; do not invent them.

Ensure feature checks use effective entitlement/status, not only a stored plan name. The return-to-site checkout page must wait for the verified entitlement instead of trusting URL parameters. Missing production credentials must not silently enable mock checkout. If payments are not configured, turn off paid purchase CTAs while preserving the free product.

Verify a sandbox purchase -> signed webhook -> persisted entitlement -> UI refresh, plus cancellation/portal/replay/plan changes. Inspect notifications so failed sends do not count as delivered and retries do not send duplicates. Test digest preferences and unsubscribe behavior.

Unify admin and self-account deletion semantics: resolve active billing safely, close relevant sessions/queued work, inventory all owned documents and screenshots, preserve required audit records and recover from partial failures. Do not delete real users or make live charges as tests. Finish with evidence distinguishing mocked tests, sandbox provider checks and remaining live setup.
```

## Prompt 8 — Finish the UX/UI of the working journeys

```text
Polish the implemented MVP journeys without a redesign or changing established API behavior. Prioritize successful task completion: signup/verification, upload/review, match understanding, CV preparation, native/external application review/status, employer review and founder operations.

The audit observed raw Material Symbols names such as close and arrow_forward in the live mobile UI. Reproduce with external fonts unavailable and replace fragile icon-font dependence with bundled SVG icons, preferably the existing lucide-react library. Keep accessible names and decorative icons hidden from assistive technology.

Use browser checks at phone, tablet and desktop widths, including roughly 390, 768 and 1440px. Fix navigation wrapping/overlap, clipped headings, actionable contrast, touch targets, focus order, keyboard operation and dialogs. Respect reduced motion. Preserve entered data after validation/network failures. Provide honest loading, empty, retry and expired-session states; a disabled button should explain what is missing.

Distinguish AISE-native submission, confirmed external receipt, candidate self-reported application, and external source link. Do not call a click on an external link a completed application. Clearly show the exact CV, employer/destination and answers before sending. No success claims from a demo animation or unknown worker outcome.

Review Azerbaijani copy and source/plan claims. Verify support contact and advertised services with the founder instead of inventing facts; do not promise thousands of active jobs, personal account managers or paid capabilities without evidence. Reuse current brand/colors/components. Take before/after screenshots of the changed journeys and report the actual browser checks. Tests should protect behavior and meaningful accessibility, not snapshot every styling change.
```

## Prompt 9 — Release verification and founder handover

```text
Prepare the integrated AISE MVP for its 5 October release. Read docs/mvp-progress.md and verify the actual current release candidate SHA. Reconcile the old launch report/runbook with the implemented system; do not copy historical passes into a fresh report.

Run the relevant API, worker and frontend tests; CPU matching self-test; production builds; migration checks; and complete browser journeys with a test mailbox, approved test employer, synthetic candidate and provider sandbox. Check that account roles, document access, feature gates and receipt states remain correct across service restart/redeployment. Record PASS, FAIL, BLOCKED or NOT RUN for each journey with dated evidence and the exact SHA.

Prepare a company-controlled VPS deployment using the existing containers and private database/Redis/worker networking. Keep Cloudflare as the entry point. Do not purchase a server, change DNS, rotate live credentials or deploy as an incidental test. List concrete owner inputs and reviewable configuration before the authorized migration. Store secrets outside Git and the frontend bundle. Add readiness checks, release identification, bounded queues, log redaction and actionable failure/backup-age monitoring.

Back up database AND uploaded files, encrypt and copy off-host, and restore into isolated resources. Verify referenced file checksums, counts/schema and application usability after restore. Measure recovery time. Review migrations and rollback compatibility; a code rollback does not reverse database changes and old data must not overwrite new applications/payments.

For the named founder ceo@aisehr.com, demonstrate login/MFA, operator access, employer approval, job moderation, application/queue diagnosis, safe retries, automation pause, audit history and backup status. Do not expose passwords, recovery codes or candidate documents in the handover.

Public external auto-apply requires the real recipient-approved receipt evidence from Prompt 6. Passing fixture tests is implementation evidence only. Payments require the provider lifecycle evidence from Prompt 7. Give separate go/no-go decisions for free native MVP, external pilot, and paid plans. Keep unsupported features honestly gated while continuing to resolve them; do not silently redefine a requested external pilot as complete.

Deliver a concise founder checklist, deployment/rollback procedure, known limitations, owners for external dependencies, and a reviewable release PR if repository access is configured. Do not claim deployment or publication unless actually authorized and verified.
```

## Owner inputs that code cannot manufacture

- Company-controlled hosting, domain, email and backup accounts; access via secure configuration rather than pasted secrets.
- Confirmation that the founder controls the `ceo@aisehr.com` mailbox before email-based recovery/invitations are enabled.
- Glorri integration permission/API details or a cooperating test employer, a named test vacancy and authorized candidate data.
- Production AI provider entitlement, limits and data-handling choice.
- Sandbox payment credentials/webhook destination if paid launch is included.
- Accurate business/support details and a human decision on advertised services and launch scope.

Do not wait for all inputs to implement and test independent code. Mark only the dependent live steps blocked.
