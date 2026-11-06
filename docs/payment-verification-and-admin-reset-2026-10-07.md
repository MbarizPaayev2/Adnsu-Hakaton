# Payment verification results and admin password reset (7 October 2026)

Production payments, document generation and e-mail applications remain **disabled** (`/billing/status`: `paymentsEnabled:false`, `documentGenerationEnabled:false`, `emailApplicationsEnabled:false`; API healthy on `55c598ce3bf7`). Payment readiness is **not** claimed: paid document generation is unavailable and its language quality is unreviewed.

## 1. Defect found and corrected: products expired after one month
Dodo's API reference defines `payment_frequency_*` as how often the customer is charged and `subscription_period_*` as the **total length of the subscription** (its own example: 12 months = a one-year subscription). The new Plus and Premium products (live and sandbox) had `subscription_period` = 1 Month, so every subscription expired after its first month instead of renewing; this is why the earlier experiment emitted `subscription.expired`.
Corrected on 7 Oct (price, currency, tax, monthly billing, no trial unchanged): `subscription_period` = **10 Years** on live Plus `pdt_0NpEIXadSkBWbtScTdN8M`, live Premium `pdt_0NpEIXnA5a2FVUp66IglB`, sandbox Plus `pdt_0NpEJFwG0ED4NiuSTtboV`, sandbox Premium `pdt_0NpEJFzpMOYblk9C1lQ1V`.
Confirmed after the change (product read-back **and** a no-charge checkout preview, both environments): Plus **8 AZN**, Premium **15 AZN**, tax included, every **1 Month**, total period **10 Year**, trial 0. A real sandbox subscription shows `expires_at` 2036-10-07.
**Not changed (legacy live products):** Basic (5 AZN), Standard (10), Limitsiz (40) still have `subscription_period` = 1 Month, so they would expire after one month too. Nobody should buy them; if they are ever sold, fix them the same way.

## 2. Evidence (private API build, retained private database `aise_payment_verify_20261007`, sandbox Dodo, official Dodo CLI relay)
**Genuine** = emitted by Dodo's sandbox, signed, delivered by the official relay into the real AISE API build and its webhook route; state read from the real database and the real `/billing/entitlements` route.
| Check | Result | Kind |
|---|---|---|
| Authenticated checkout (Plus, Premium) | 201, hosted `test.checkout.dodopayments.com` session created by the AISE API; unauthenticated 401; `free` plan 400; portal before any purchase 400 | genuine provider session |
| Successful renewal (Plus) | subscription created with a saved sandbox test card (no card typed by the agent), activation reached the account (PLUS); `next_billing_date` moved +60 s; Dodo charged, `subscription.renewed`/`payment.succeeded`; period end moved 15:26:24 → 15:27:29; still PLUS/active; allowance **30**/month | genuine |
| Failed renewal (Premium) | saved decline test card (…0341) made the payment method; renewal charge failed: `payment.failed`, `subscription.updated`, **`subscription.on_hold`**; stored status `on_hold`; **effective plan FREE, allowance 5** (the stored plan column still says PREMIUM, the entitlement is derived from status) | genuine |
| Recovery | payment method switched back to the good card: Dodo reactivated the subscription at once; PREMIUM active, document cap **none** | genuine |
| Scheduled cancellation | `cancelAtPeriodEnd=true`, still PREMIUM/active until period end | genuine |
| Immediate cancellation | `subscription.cancelled`: FREE, allowance 5 (Plus: same, 30 → 5) | genuine |
| Customer portal | `POST /billing/portal-session` for a subscribed user: 201, `test.customer.dodopayments.com` link (also returned for a cancelled user, who still has a customer record). Cancellation inside the portal UI was **not** exercised | genuine provider session |
| Duplicate delivery | same webhook id sent twice: second answers `duplicate:true`, one stored event | **fixture** (signed with the real sandbox secret) |
| Tampered body, stale timestamp (10 min), unsigned | all 400 ("No matching signature", "timestamp too old") | **fixture** |
| Account isolation | a signed event naming user B in its metadata for user A's subscription changed nothing for B; A stayed PLUS (state is read from the provider, never from payload claims) | **fixture** |
Webhook event outcomes in the table: `synced:*` for subscription events, `ignored` for payment-only events, as designed.

## 3. What this does not prove
No month-long natural renewal (renewal was forced by moving `next_billing_date`); refunds, plan changes, proration and timezone boundaries untested; the hosted checkout and the portal were not driven through the Next.js UI (API level only); card entry on Dodo's hosted page was not repeated (earlier session evidence only); no live charge or live subscription was created; analytics, Redis workers, document model and e-mail were not exercised.
**Correction to an earlier claim:** the previous handoff treated `subscription.expired` as expiry evidence only; it was in fact the product-duration defect above.

## 4. Cleanup
Private API (port 4471) and CLI relay stopped; the sandbox relay webhook is **disabled**; sandbox subscriptions: 3 cancelled, 1 expired, 1 failed, **none active**. Retained: the private database and the evidence files in `~/aise-preview/payments-2026-10-07/` (private, mode 600).

## 5. Resetting the admin password for ceo@aisehr.com (not yet done)
`apps/api/src/scripts/admin-recover.ts` is private, interactive and ships in the production API image. It changes nothing unless you type the e-mail to confirm; it asks for the new password with a hidden prompt (twice, at least 12 characters), never takes it from the command line, a file or the environment, ends **all** sessions of that operator and writes an audit entry (`ADMIN_RECOVERED_VIA_CLI`). It cannot create accounts or change roles. Checked on 7 Oct: the account `ceo@aisehr.com` exists (SUPER_ADMIN, enabled, **MFA not enabled**); the script path was dry-run in the production image with answers that change nothing.
**Simplest secure procedure (the founder does it; the engineer never sees the password):**
1. Generate a long password (20+ characters) in the password manager and keep that window open.
2. In Terminal on the Mac run (one line):
```bash
ssh -t -i ~/.ssh/aise_production tefma@100.89.219.95 'docker exec -it aise-api npm run script:admin-recover:prod -- --email ceo@aisehr.com'
```
3. Answer `y` to "Set a new password?", paste the password twice (nothing is shown), type `ceo@aisehr.com` to confirm. It prints "Done: password; all sessions ended."
4. Open `https://aisehr.com/admin`, sign in, then **enrol MFA** (authenticator app, save the recovery codes in the password manager). Only then delete `~/aise-preview/secrets-handoff/admin-mfa-key.env` after its content is in the password manager.
5. Never put the password in chat, Git or a file. If the command fails, nothing was changed; tell the engineer the last line it printed.
Also found: a second admin, `aminvit693@gmail.com` (role ADMIN, no MFA). Confirm who it is; if it is not needed, disable it in the admin screen (the engineer has not changed it).
