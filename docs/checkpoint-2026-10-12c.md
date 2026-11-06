# Checkpoint C — 12 October 2026 (payment recovery, hosted checkout handover)

No secrets or personal data. Supersedes checkpoint B for the items below.

## Production (unchanged this session)
`19745bb38c8b89ca46f879422442e63e78585645`, API `sha256:e56d4710bff8…`, web `sha256:95b26df32ae5…`, 58 migrations, backup `20261012T062141Z`. Rollback: `RELEASE_SHA=96ffb8280adc86aa08fc2b886a8feddcfa68c3c7 scripts/rollback-images.sh 96ffb8280adc api web`. Flags as in checkpoint B (autonomous browser mode off, external auto-apply off).

## Blocked: GitHub Actions cannot start
PR #59 (`codex/payment-recovery-20261012`) CI fails in 3 seconds on both jobs: *"The job was not started because recent account payments have failed or your spending limit needs to be increased"* (annotation on the run). No code failure. Per the release rule (exact-commit CI before merge), **PR #59 is not merged and not deployed**. Needs the founder: GitHub → AISE-AZ organisation → Settings → Billing & plans → fix the payment method / raise the Actions spending limit, then "Re-run all jobs" on PR #59. Local evidence meanwhile (not a substitute for CI): API unit 96 suites / 1,587 tests passed, web 71 files / 448 tests passed, billing-lifecycle e2e 9/9, typechecks clean.

## Code in PR #59 (ready, unmerged)
1. **Missing subscription row:** a verified paid subscription whose metadata names an existing user with no `Subscription` row was acknowledged as `unmapped` and the delivery marked processed, so the entitlement was never granted and a retry was ignored. Now the FREE row is created (idempotent upsert on the unique user id) and the provider's state applied. Unknown users stay `unmapped`. Tests: repeat delivery acknowledged as duplicate, a second delivery of the same state changes nothing, still one row.
2. **Payment before onboarding:** the onboarding redirect dropped `?checkout=success`, so the plan confirmation never appeared. The redirect now keeps it and the onboarding screen shows the existing `CheckoutReturn` (announces a plan only from verified backend state; a return URL alone shows "Ödənişiniz yoxlanılır…").

## Sandbox checkout evidence (isolated stack, Dodo sandbox, genuine signed events via the official relay)
`~/aise-preview/checkout-2026-10-12/journey2-result.json` — **20 / 20**, each check labelled by how it happened:
| Group | Checks | How |
|---|---|---|
| A. Premium | pricing 15₼ + 100 e-mail applications + no document cap; checkout?plan=premium and pay button reach `test.checkout.dodopayments.com`; abandoned checkout stays FREE; payment accepted; PREMIUM granted; entitlements (documents uncapped, e-mail 100); return page "Ödəniş təsdiqləndi — PREMIUM"; documents screen "Limitsiz"; settings PREMIUM; cancellation returns FREE 5/5 | BROWSER for screens, PROVIDER-API for the payment/cancel, WEBHOOK genuine |
| B. Payment first | a not-yet-onboarded candidate lands on the wizard; Plus pay button reaches hosted checkout; PLUS granted; the return marker survives the redirect; onboarding shows the verified confirmation and still offers the wizard; a return URL without payment shows no confirmation | BROWSER / PROVIDER-API / WEBHOOK |
| C. No row | account with no row pays → row created, PLUS granted, one row | PROVIDER-API / WEBHOOK |
Earlier run (checkpoint B): Plus, decline, replay, forged delivery, portal, scheduled and immediate cancellation — 33/33, not repeated.

**Not done by me, by rule:** typing card numbers into the provider's hosted card form. My operating rules prohibit entering card details outside a locally served page, even sandbox test cards, so that step is a person's. Everything up to it is prepared (below).

## Handover: operate the hosted card form (founder, ~1 minute)
The built-in browser pane is signed in with a synthetic account (`aise-hosted-checkout@example.com`, FREE, onboarded) and sits on the Dodo **sandbox** page "AISE Plus [Sandbox] — AZN 8.00 / Month — Test Mode; no real charges". Fill the card section with Dodo's published test card (number 4242 4242 4242 4242, any future expiry, any 3-digit CVC, any name/address) and press pay. You are returned to `http://127.0.0.1:4482/dashboard?checkout=success`. Then tell the engineer "hosted form done", who runs `node ~/aise-preview/checkout-2026-10-12/verify-hosted.mjs` (reads only verified backend state; expected: plan PLUS, status active, documents 30, e-mail 30, deliveries processed). Use a real card? **Never.**

## Lever assisted application (Priority 2) — prepared, blocked on input
All **39** Xsolla postings in the catalogue answer HTTP 200 on the Lever page and its `/apply` form (checked 12 Oct 07:00 UTC; collector last saw them 11 Oct 13:50). Entry-level candidates for a first test: AI-First Engineering Intern, Junior Application Security Specialist, Finance Coordinator, Project Coordinator, IT Support Engineer (list: `xsolla-open-check.json`). Missing input: one consenting candidate with an approved CV and, if wanted, an approved vacancy letter; the chosen posting; the candidate's own Chrome with the extension paired; their explicit go-ahead for that specific application. Checklist: `docs/browser-agent-live-check-2026-10-12.md`. Autonomous mode stays off.

## Acquisition (Priority 3)
- Persisted progress read: SmartJob generation `7ecbe5af…`, 1 deep segment (04:04 UTC), cursor `queue → smartjob.az/sitemaps/jobs/1`, 1,208 listed in generation, next segment 10:04 UTC; HelloJob single partial run (`Source HTTP 500`, 99 created) in backoff, next 21:44 UTC. No reproducible defect; bounded partial runs closed nothing.
- Measurement 12 Oct ~07:00 UTC, same predicate: **1,532** actionable, **296** employer names, **15** explicit-email (12 employers: Academor, EDU Company, FZ Academy, AzProtein Foods Group, Balli Bisi, Signaltake, Voxera Solutions, Light viza, LLG, Luxe Life Group, ADA University, Ateshgah Sigorta). Net change since 05:07 UTC +6; no new sources were released (the release path is blocked, above).
- Technical discovery produced no additional adapter worth building; employer recruitment list (30 largest current employers + the 12 e-mail employers) and the Azerbaijani invitation matching the live offer are in `~/aise-preview/employer-recruitment-list-2026-10-12.md` and `employer-invitation-az-2026-10-12.md`. **Nothing was sent.**

## Processes left running (stop when done)
Sandbox stack for the hosted-form handover: API PID 49114 (port 4481), web PID 49118 (port 4482), relay PID 49116 (`dodo wh listen`), database `aise_checkout_verify_20261012`, sandbox webhook endpoint **enabled** (`node ~/aise-preview/payments-2026-10-07/relay-enable.mjs off` afterwards). Stop: `kill 49116 49118 49114`; drop the database with `docker exec aise-postgres psql -U postgres -c "drop database aise_checkout_verify_20261012"`. Production has no new processes.

## Next
1. Fix GitHub billing → re-run CI on PR #59 → merge → build api+web → fresh R2 backup + restore → deploy → verify.
2. Hosted form step (above), then `verify-hosted.mjs`.
3. Candidate-authorized Lever application.
