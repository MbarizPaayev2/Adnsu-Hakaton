# Candidate-approved e-mail applications, source registry and application tracking

Review checkpoint: 2 October 2026. Branch `codex/vacancy-email-applications`, stacked on `codex/deploy-vacancy-expansion` (which already contains the Hellojob/ABB collectors, the public catalogue and the employer collectors of PRs #13–#15). **Not merged, not deployed.** Real sending, unattended automation, scheduled collection, paid checkout and external browser auto-apply are all off. The existing deployment gates (durable off-host backup, alert destination, exact-head CI, images built from the merged commit, rollback rehearsal) are not waived.

## What it does

**Sources and catalogue**
- `JobSource` registry (identity, URL, method, scope, access review, applicable application methods). Health is *computed* from import runs and postings, never stored twice: last run, last success, last verified-complete listing, accepted/rejected/skipped/expired/closed counts, open/active/closed/duplicate counts.
- Public-collector runs are reported by the import CLI (`--apply`) to `/internal/jobs/import-runs`. Only a verified-complete listing can close postings, and only after **two consecutive** complete listings lack them; a listing that shrank below half of the previous complete one, an incomplete or errored one, or one with failed detail parses closes nothing. Each run has a durable identity (`runKey`), is recorded with its closure counts in one transaction under a per-source lock, and replaying or racing a report cannot count a miss twice. Out-of-order reports close nothing. Glorri keeps its own importer and lifecycle.
- Azercell exception: the 20,367-character posting is imported whole (limit raised to 40,000; collectors still reject longer text, nothing is truncated). When the posting text states a deadline that contradicts the structured one, the earlier date is used and the conflict is flagged; nothing is invented.
- Jobs record work arrangement, experience level and (only from explicit posting text) an application e-mail with evidence. Unknown stays unknown. `/jobs` filters: company, work format, experience, each with an explicit "unknown" bucket.

**E-mail application (Mode A, default: review and send)**
- Offered only when the posting itself names exactly one application address (two different addresses = ambiguous = none). Published subject, reference number and instructions are kept verbatim; a published subject is locked.
- Candidate previews recipient, subject, letter, CV and "what is shared", must acknowledge the instructions and consent. The starting letter states only the role and that a CV is attached.
- CV must be the candidate's own, ready, and (if tailored) approved and made for this vacancy. Approval fixes `payloadSha256`, copies the CV into private storage and refuses a stale preview or changed CV.
- Free-mail addresses (Gmail etc.) are accepted only when the vacancy explicitly gives them for applications; HR addresses are never guessed.
- One application per candidate per vacancy, including cross-source repeats and repeats whose duplicate link was released (same title to the same address). Concurrent approvals are serialised per candidate.

**Delivery**
- Durable DB row is the queue; BullMQ only wakes a worker. A worker claims atomically (`QUEUED→SENDING`), then **every** check runs, on freshly read data, both before the attempt is recorded and again immediately before the provider call: vacancy still open/visible, approved address and instructions still what the posting says, suppression, recipient authorization, emergency pause, candidate pause/consent, automation permission, cancel request, approved payload and CV bytes. A stopped attempt makes no provider request and records why (`stopped_before_send:<reason>`).
- Cancellation limit, stated precisely: cancel works while the application is awaiting approval, queued, or held; once the provider request has begun it cannot be recalled.
- Outcomes: accepted; definite rejection (failed); retryable non-acceptance (429 or no connection: bounded retries, backoff); anything possibly accepted (timeout, reset, 5xx, unreadable 2xx, concurrent-idempotency 409, crash after the call) is **uncertain**, never retried automatically. Candidate retry needs an explicit duplicate-risk acknowledgement; it reuses the idempotency key while the provider still remembers it (24 h from the uncertain attempt) and uses a new key afterwards (a duplicate is then possible, and the candidate was told).
- Webhooks: Svix signature over the exact raw bytes, 5-minute window, de-duplicated by event id. Evidence only accumulates and the state is derived from the strongest evidence, so late or repeated events cannot move it back. An event must agree with the application on message id, tag **and** recipient; the candidate's own copy (Bcc) delivering or bouncing is not the employer's delivery or bounce and is recorded as ignored. Opens/clicks are neither stored nor acted on. Provider acceptance, delivery and opening are never presented as employer acknowledgement, interview or acceptance.
- Bounces (non-transient) and complaints suppress the recipient. Daily limits per candidate, recipient and globally.

**Tracking**: separate delivery and recruitment states; candidate-reported updates with evidence-labelled history; interview instant + IANA zone + notes; opt-in reminder to the candidate only; optional inbound replies (off) with token correlation, metadata only, attachments never fetched, subject-based suggestions that need the candidate's confirmation.

**Mode B (automatic, off)**: separate deployment switch and candidate opt-in with rules and base CV; same preparation, hash, snapshot and sender gates; stops on unknown city, excluded terms or extra requirements; daily limit; disable/revoke/global pause stop it before sending.

**Controls**: candidate pause, cancel-pending, revoke consent; operator emergency pause flags (`email_apply.sending`, `email_apply.automation`, `import.scheduled`).

**Account deletion**: locks the candidate's e-mail rows in the deletion transaction (a worker claim waits on that lock: either the claim came first and deletion is refused, or the rows are gone before any claim), removes private CV copies, reports unconfirmed sends, treats an analytics failure as non-fatal. Late webhooks for deleted records are stored as unmatched metadata only (purged after 7 days).

**Operators** (`ops.read`): source coverage, queue health, uncertain attempts, aggregate delivery rates, funnel without personal data, audited metadata-only lookup (`applications.read`). Operators cannot read letters, subjects, CVs or full recipient addresses.

**Scheduled refresh (off by default)**: `SOURCE_SCHEDULE_ENABLED` + per-source `scheduled` (never Glorri, never a source without a reviewed collector, never `RESTRICTED`); one source per 10-minute tick; lease against overlap; ≥6 h interval; ≤12 pages / 200 jobs / 2 s spacing per run on top of each collector's robots/timeout/size rules; exponential backoff up to a week; honest labels (`scheduled` / `paused` / `manual`, `stale`, `never_completed`).

## Actual coverage (measured, not claimed)
- Registry: 8 sources (Glorri, Hellojob, ABB, PwC, SOCAR, Azercell, EY, Halliburton). 100 employer targets are *registered*; **6 have collectors** (4 SAP careers tenants, ABB, PwC). Not complete Azerbaijan coverage.
- Local development copy (not production): 855 active Glorri rows, **0** with an explicit application e-mail; work format known for 3, experience level for 121.
- Bounded read-only Hellojob preview (33 postings fetched; the run ended on a timeout): **7** gave one explicit application address, some free-mail. Production counts were not measured.
- Verified-employer-approved addresses are **not implemented** (follow-up).

## Configuration (all default off)
`EMAIL_APPLY_ENABLED`, `EMAIL_APPLY_TRANSPORT=sink|live` (default sink, loopback only), `EMAIL_APPLY_SINK_URL`, `EMAIL_APPLY_FROM`, `RESEND_API_KEY`, `EMAIL_APPLY_WEBHOOK_SECRET`, `EMAIL_APPLY_RECIPIENT_ALLOWLIST`, `EMAIL_APPLY_REAL_RECIPIENTS`, `EMAIL_APPLY_{USER,GLOBAL,RECIPIENT}_DAILY_LIMIT`, `EMAIL_APPLY_MAX_ATTEMPTS`, `EMAIL_APPLY_PROVIDER_TIMEOUT_MS`, `EMAIL_APPLY_RETENTION_DAYS`, `EMAIL_APPLY_AUTOMATION_ENABLED`, `EMAIL_APPLY_INBOUND_ENABLED` (+ `EMAIL_APPLY_INBOUND_DOMAIN`), `SOURCE_SCHEDULE_ENABLED`. The process refuses to start with an unsafe live configuration (no key, no verified sender, no `whsec_` secret, or neither an allowlist nor explicit real-recipient authorization). `npm run script:email-sink` starts the local capture server. `npm run script:report-source-coverage` prints measured coverage.

## Migrations and rollback
Additive only, in order: `20261005090000_source_registry_and_job_facts`, `20261006090000_email_applications`, `20261007090000_email_automation_decisions`, `20261008090000_job_import_run_key`, `20261009090000_source_schedule`. New enums/tables/nullable-or-defaulted columns; the first migration also fills `workArrangement`/`experienceLevel` from payload fields already stored (idempotent) and seeds the 8 registry rows. Rolling the code back leaves the new tables/columns unused (safe for the previous release); no existing column changes. `express.json` limit raised to 512 kb for 40,000-character descriptions. Account deletion now also touches `EmailApplication` (cascade).

## Evidence (exact, for head recorded in the PR)
- API unit: 52 suites, 674 tests pass. API `nest build` passes.
- API e2e on isolated `aise_phase2_test`, run sequentially: 22 suites, 185 tests pass — e-mail application (46), admin e-mail/source ops, admin ops, source registry/closure/replay (10), source scheduler (5), catalogue, import, dedup, account access (4), billing/account deletion, native application, tailored CV, matching, rescore, CV, external-apply (fixture), app boot.
- Web: 25 files, 151 tests pass; `tsc` clean; `next build` passes. ESLint is not clean repository-wide (pre-existing, 142 problems incl. `any`); the new web files are clean except one pre-existing line in `posthog-provider.tsx`.
- Browser (Chrome for Testing → real Next/Nest/Postgres/Redis worker): 20 checks pass — browse/filter, sign-in return, no-CV refusal, onboarding, preview, double-click approval, exact CV bytes, delivered webhook, interview with zone, uncertain delivery, bounce suppression, pause/cancel, Mode B, revoke, expired vacancy, unapproved tailored CV, keyboard-only approval, other candidate denied, view-only operator denied, phone layout.
- **Evidence levels.** Everything above uses a **local fake provider** that models Resend's documented contract (Idempotency-Key 24 h and 409 `invalid_idempotent_request` / `concurrent_idempotent_requests`, `tags` object, `to` array, bounce type). **No real-provider (Resend) send, webhook or domain verification has been performed.** The second candidate's session in the browser check was created through the API login, and a few fixtures (tailored resume row, job rows via the real ingestion service) were created directly; user actions themselves went through the UI.
- Not run: `jobs-matching-real-scorer` (needs `AISE_REAL_SCORER_URL`) and `external-apply-real-worker` (needs the real apply worker); they fail without those services and are unrelated.

## Defects found while verifying (fixed)
- `account-access` e2e "regression": the suite defaulted to the stale `aise` development database (missing newer columns). Not a code regression; it now requires `aise_phase2_test`.
- The whole-app e2e (`app.e2e-spec`) and any app boot against a shared Redis could run a queued Glorri scrape (real requests to glorri.az, writing 355 rows into the isolated DB, twice during this review). The importer's processor now honours `GLORRI_SCRAPER_ENABLED=false` for already-queued runs (production, where it is unset, is unchanged) and the test sets it. The stray rows and stuck `RUNNING` runs in the isolated database were removed. The whole-app e2e also hung on close on the base commit `8e56a76` before this change; it now passes.

## Unresolved / follow-up
- Real-provider verification and a controlled pilot (verified sender domain, API key, signing secret, allowlisted recipients). Real employer recipients need the founder's explicit authorization.
- Inbound replies need an MX/DNS decision (`EMAIL_APPLY_INBOUND_DOMAIN`); bodies are deliberately not read.
- Verified-employer-approved recipient support is not built.
- Source access/attribution reviews are all "terms pending"; Hellojob/ABB/etc. are not scheduled; no new collectors were added.
- Dedup of vacancies relies on the existing conservative linker plus same-title/same-address; unrelated same-title roles at one address would also be treated as one vacancy.

## Controlled live-pilot prerequisites
1. PR #12 release gates satisfied and this branch reviewed by the founder.
2. Resend domain verified; `EMAIL_APPLY_TRANSPORT=live`, key, `EMAIL_APPLY_FROM`, `EMAIL_APPLY_WEBHOOK_SECRET`, webhook endpoint `/webhooks/resend` registered (events: sent, delivered, delivery_delayed, bounced, complained, failed).
3. `EMAIL_APPLY_RECIPIENT_ALLOWLIST` limited to controlled inboxes; `EMAIL_APPLY_REAL_RECIPIENTS=false`.
4. Automation and inbound stay off; scheduler stays off.
5. Rehearse: send, delivered, bounce, complaint, uncertain timeout, pause, emergency pause, account deletion — against the real provider and controlled inboxes — and record the evidence separately from this document.
