# External application automation: development phase (29 September 2026)

This is a separate phase from release PR #6.
- **Branch:** `claude/external-apply-automation`, from the verified release candidate `8a07552`.
- **Live submission is off:** `EXTERNAL_APPLY_LIVE_ENABLED` is unset.
- Paid plans are off.
- The hourly Glorri importer is unchanged.

## What already existed

These were verified before any change:
- **Server-side gates.** Blocking reasons are checked in order: plan, live gate, operator pause, pilot list, captured declaration.
- **Consent.** A per-application consent is bound to the declaration's hash and version, the exact fields and document hashes, and the destination.
- **Bounded worker.** The browser worker has a session TTL (20 min), a maximum number of sessions, and action and send timeouts.
- **Idempotent attempts.** Double clicks and retries replay the first attempt. OTP attempts are capped at 5, with a daily send limit.
- **Truthful outcomes.** A receipt is "confirmed" only when it satisfies the destination's receipt contract. Timeouts, dropped connections, malformed replies and stale attempts end as `DELIVERY_UNCONFIRMED`, and are never resent.
- **Assisted apply.** The candidate is pointed to the posting after a CAPTCHA, after an uncertain send, and when the destination is blocked.

## What this phase adds

- **Per-destination capability** (`destinationCapability`), derived from the reviewed registry entry:

  | Field | Values |
  |---|---|
  | `preparation` | `AVAILABLE`, or `NOTICE_NOT_CAPTURED` |
  | `receipt` | `VERIFIED_BY_CONTRACT`, or `NOT_VERIFIABLE` |
  | `rejection` | `DETECTED_BY_CONTRACT`, or `NOT_DETECTABLE` |
  | `identityDocumentRequired` | true or false |

  It is returned on the per-match capability, the preparation and the application. Each includes a validated **apply-yourself** URL: https only, on the destination's own hosts.
- **Receipt expectation, stated in advance.** When a destination has no receipt contract, the candidate is told three times: on the match card, before consenting, and in the final irreversible confirmation. The message says that the send will end as «Çatdırılma təsdiqlənməyib» and that they should check on the site.
- **Apply yourself when automation is unavailable.** When the destination itself is the reason (no captured declaration, unusable posting data), the match card states it and points to the existing "Glorri-də bax" link and the "Müraciət etdim" button. It does not add new controls.
- **Account and rollout reasons stay silent.** Plan, pilot, live gate and operator pause show nothing on the card, as before. In production today, with automation off and paid plans off, the card is unchanged, so no one is told to upgrade to a plan they cannot buy.

## Verification

All of this was run on a local Mac.

| Check | Result |
|---|---|
| API typecheck (CI config) and web typecheck | PASS |
| API unit tests | 397 passed (35 suites), including the new capability, link-validation and no-destination tests |
| Web unit tests | 110 passed, including the new card, consent and final-confirmation tests, and a check that account or rollout reasons (plan, pilot, live gate, pause) stay silent on the card. They fail with the UI change removed |
| Apply-worker unit tests (unchanged code) | 44 passed |
| API e2e, real Postgres and Redis (`aise_phase2_test`) | `external-apply` 14/14; `external-apply-real-worker` 10/10 |
| Browser journey: real worker process, system Chrome, fixture ATS, Next dev UI | 9/9 (below) |

The browser journey (`apps/api/test/phase6-real-worker-browser.ts`) covers:
1. **Login** as a synthetic candidate.
2. **Required questions.** The review shows the worker's screenshot. A double click sends once, and the validated receipt is shown.
3. **Visible CAPTCHA.** The flow stops and nothing is sent. Assisted apply is offered.
4. **OTP.** A wrong code, then the right one, ends with the receipt.
5. **Dropped connection.** The outcome is «Çatdırılma təsdiqlənməyib», with no resend.
6. **No captured declaration** (new). The card shows the reason and the apply-yourself route. Nothing reaches the site.
7. **No receipt contract** (new). The candidate is warned before consent and at the final send. The fixture shows its own receipt, but AISE reports «Çatdırılma təsdiqlənməyib» and the row stays `DELIVERY_UNCONFIRMED` with no reference.
8. **Documented refusal** (new). The outcome is `FAILED` / `DESTINATION_REJECTED`, with no receipt.
9. **Slower than the API's send timeout** (new). The outcome is «Çatdırılma təsdiqlənməyib». The site's receipt arrives later and is not trusted, and nothing is resent.

## Fixture-only: not proven against Glorri

- **Glorri's real form:** fields, questions, identity document, declaration text, OTP behaviour, confirmation page and refusal page. Everything above ran against AISE's own fixture ATS.
- **No real Glorri receipt** has been observed. `GLORRI_DESTINATION.notice` and `.receipt` stay `null`, so Glorri is assisted-only.

## External inputs needed for a live pilot

These are listed in `docs/glorri-partner-request.md`, which has not been sent:
- written permission, for the importer and for submission;
- the declaration text and version;
- a test environment, or an approved test vacancy with a cooperating recipient;
- a receipt and refusal contract;
- rate limits and contacts.
