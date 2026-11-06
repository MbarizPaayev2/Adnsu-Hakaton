# Employer plans: Sınaq, Tək vakansiya, Biznes (11 October 2026)

Status: **implemented behind two switches, both off by default** (`EMPLOYER_PLANS_ENABLED`, `EMPLOYER_BILLING_ENABLED`). With both unset the vacancy flow is exactly what it was before this change. Nothing here changes candidate plans (Free / Plus 8 AZN / Premium 15 AZN) or candidate allowances.

## 1. What the three plans are

| | Sınaq | Tək vakansiya | Biznes |
|---|---|---|---|
| Price | free, no card | **20 AZN**, one time, tax included | **100 AZN / month**, tax included |
| What it covers | the company's first vacancy | one vacancy | any number of legitimate vacancies of one verified company |
| Duration | **14 days from actual publication** | **30 days from publication** | while the subscription is active; every listing is reconfirmed at least every 60 days |
| Renewal | none | none (no auto-renew, no subscription); another 30 days only by an explicit new purchase | monthly subscription, cancel any time, active until the paid period ends |
| Availability | once per verified company (also by normalised company name and by website domain) | repeatable | one active subscription per company |
| At the end | new applications stop; received applications stay accessible | same | same; listings stop after a failed renewal (3-day grace) and come back when the subscription is active again, inside their own deadline |

All plans include the company profile and logo, the application inbox and candidate-stage management of the existing employer workspace. Plans are **company-owned**: nothing is attached to a user account, and candidate plans are a separate subject. Paying does not change matching scores; collected third-party vacancies are not part of any plan.

## 2. Vacancy lifecycle (server-enforced)

```
DRAFT ──submit──▶ PENDING_REVIEW ──approve──▶ APPROVED ──publish (entitlement)──▶ ACTIVE ──▶ EXPIRED
   ▲                    │                          │                                 │ ▲        │
   └──── (text edited)──┴──reject──▶ REJECTED ──submit again                          PAUSED     └─ publish again (entitlement)
```

* `ACTIVE` remains the single "public and applicable" state; every public read, matching, alert, saved-item and apply path additionally requires `expiresAt` to be in the future, so a period that has ended closes the listing **immediately**, before the five-minute sweeper has marked it `EXPIRED`.
* **Payment before moderation:** a purchase only creates an unspent company credit. Nothing is consumed until the vacancy is approved *and* the employer publishes it.
* **Moderation rejection** before publication spends nothing. An operator rejecting a *published* listing removes it from view; its applications remain; the credit that published it stays consumed (see §6, open decision).
* **Text change after approval:** an approved but unpublished vacancy whose title/description/requirements/responsibilities change goes back to `DRAFT`, so approval always covers the text that was reviewed.
* **Company suspension:** listings are not public (existing company check), checkout and publishing are refused, clocks keep running, and reinstatement restores listings inside their period.
* **Concurrency:** publishing and extending run in one transaction holding a row lock on the company; a credit is spent with a conditional update. Five parallel publishes with one paid credit publish exactly one listing; two parallel first publications start one trial (database-unique per company, name key and domain key).
* **Deadline:** every period is capped at the vacancy's own `deadline`; the listing then closes on that date with reason `DEADLINE`.
* **Reconfirmation (Business):** `POST …/reconfirm` moves a listing's end to at most 60 days ahead and never beyond the paid period end. No count cap exists.

## 3. Payments (Dodo)

* Separate provider products: **AISE Tək vakansiya (30 gün)** one-time 20 AZN, tax inclusive; **AISE Biznes (aylıq)** recurring monthly 100 AZN, tax inclusive, `payment_frequency` 1 month, `subscription_period` **10 years** (it is the *total* length: a one-month period would expire after the first charge — the defect found on 7 October for Plus/Premium).
* **Idempotent checkout:** the client sends a key per purchase intent; the server stores one `EmployerPurchase` per `(company, key)`. A retry returns the same purchase and never a second provider session.
* **Grants come only from the provider's own record.** The signed webhook (standardwebhooks) is de-duplicated by delivery id; then the payment/subscription is *re-fetched* from the provider. Payload claims (plan, company, status, amount) are never trusted. For a single listing the provider's `total_amount`, `currency`, product id and `metadata.purchaseId/companyId` must all match, otherwise nothing is granted.
* **Failed purchases grant nothing; duplicates and out-of-order deliveries are safe** (conditional status transition + unique credit per purchase; an older subscription's late event cannot overwrite a newer contract).
* A provider outage while verifying returns a retryable error so the provider redelivers; nothing is granted from a guess.
* Business entitlement is `status = active` (with the same 3-day renewal grace as candidate subscriptions); `cancel_at_next_billing_date` leaves it active until the period ends.

## 4. Switches and rollout

| Switch | Meaning | Default |
|---|---|---|
| `EMPLOYER_PLANS_ENABLED` | new vacancies are drafts and need review + entitlement; expiry, sweeper, moderation queue, plan screens | off |
| `EMPLOYER_BILLING_ENABLED` | employers may open checkout (also needs `PAYMENTS_ENABLED=true` and provider product ids) | off |
| `DODO_PRODUCT_ID_EMPLOYER_SINGLE` / `DODO_PRODUCT_ID_EMPLOYER_BUSINESS` | provider products | unset |
| `EMPLOYER_VACANCY_AUTO_APPROVE` | approve automatically when every automatic check passes (people decide otherwise) | off |

`scripts/host-config.sh flag EMPLOYER_PLANS_ENABLED true|false` (and `EMPLOYER_BILLING_ENABLED`), `preflight`, `verify-deployment.sh` (`EXPECT_EMPLOYER_PLANS`, `EXPECT_EMPLOYER_BILLING`) and `check-host-security.sh` all state the intended value explicitly; unset counts as off and a mismatch fails the check.

**Rollback:** set both switches to `false` and recreate only the API. Existing vacancies keep their statuses (legacy vacancies have no plan fields and keep their previous rules); nothing is deleted. Because `ACTIVE` plan vacancies carry an `expiresAt`, public reads keep honouring it even with plans off, so a trial or paid listing never silently outlives its period by switching the flag off.

## 5. Legacy and edge policies decided here

* **Vacancies that existed before plans** have `publicationPlan = null` and `expiresAt = null`: they keep their previous rules until their company publishes under a plan. They are never expired by this change.
* **Employer-facing copy** states prices, durations and "no auto-renew" from server state; the landing and pricing page show a price only when the server marks the offer purchasable and payments are on.
* **Admin:** reviewers see the automatic check findings (too short, too many links, spam terms, duplicate of an open listing). Moderation reuses the `listings.read` / `listings.moderate` permissions and writes the admin audit log.

## 6. Open decisions (not silently invented)

1. **Refund policy for employer purchases.** Prepared and published (docs/employer-refund-policy-2026-10-11.md; `/refund#isegoturen`) with operational handling; the 14-day window and the no-pro-rata rule are proposals for the founder to confirm.
2. **A listing an operator takes down for breaking the rules** keeps its consumed credit and is not refunded (stated in the policy); a platform-failure withdrawal is refunded only through the operator action.
3. **Proposed future Biznes benefit (not built, not offered, not advertised):** three 7-day vacancy boosts per month. Any boost would be labelled "Promosyon", could not change matching scores, and would be added to the copy only when it works.
4. **Team seats** are not part of any plan (one login per company), because no team feature exists.

## 7. Evidence (11 October 2026)

Everything below ran against isolated resources: a private database, a private API build of this branch, the Dodo **sandbox**, synthetic accounts; no live charge, no real employer or candidate, no production host change. Genuine = state read from the provider; webhook deliveries came through the official `dodo wh listen` relay (signed by the provider).

| Layer | Result |
|---|---|
| API e2e `test/employer-plans.e2e-spec.ts` (fake provider, real routes, real DB) | 17/17: draft→review→trial; trial once per company/name/website; apply stops at expiry while received applications stay; single-listing checkout idempotency, provider-confirmed grant, duplicate delivery, failed payment, wrong amount/currency/company, unknown purchase, forged payload claims, provider outage retry, session-id mapping; 30 days capped by deadline; explicit extension; one credit under 5 concurrent publishes; two concurrent first publications → one trial; Business with no cap, cancellation, failed renewal, lapse and restore, stale older subscription, unknown company; moderation reject/resubmit; text change after approval; suspension; company isolation; candidate/employer separation |
| Regression e2e (catalogue, alerts, matching, billing lifecycle, product entitlements, admin ops, timeline, native apply) | 9 suites / 86 tests pass |
| API unit | all pass (1378 + updated specs); web 67 files / 435+ tests pass; both typechecks clean |
| **Real sandbox journey** (`sandbox-journey.mjs`, genuine provider) | **35/35**: provider read-back of both products (20 AZN one-time, 100 AZN monthly, tax inclusive, 10-year contract length) and no-charge checkout previews (2000 / 10000 AZN); registration → verification → operator approval; trial publish; second vacancy refused; applications stop at trial end; real hosted checkout sessions for both products; a real sandbox payment through a confirmed checkout session granted exactly one credit via the genuine `payment.succeeded`; Business activated by the genuine subscription event; six more listings, no cap; scheduled cancellation keeps it active; genuine cancellation; **the real 5-minute sweeper** lapsed six listings and ended the trial listing; a new subscription replaced the old contract and the sweeper restored the six listings; applications untouched throughout |
| **Browser journey** (`browser-journey.mjs`, real Next app, Chromium) | **24/24**: dashboard plan card; form note; draft → review → operator queue approval (spends nothing) → cost shown before publish → trial publication with end date; public page; "Plan seç" instead of a dead button; billing page prices from the server; "20 AZN ödə" navigates to the provider hosted checkout (observed and aborted — the card form was **not** operated); return page shows the grant only after the server has it; Business activation, refresh persistence; five more listings; **no horizontal overflow at 320/390/768/1440** on dashboard, vacancies, billing, form, operator queue, pricing and landing; keyboard reaches the plan buttons; reject dialog closes on Escape and returns focus; employer sees the rejection reason and resubmit; no uncaught page errors from the application |

> **Amounts, stated once and exactly:** the system stores money in qəpik: **2000 qəpik = 20.00 AZN** (Tək vakansiya) and **10000 qəpik = 100.00 AZN** (Biznes). The provider's checkout previews return `2000` and `10000` in the same unit.

### Live provider products (created and read back on 11 October; enabled after the release gates, see `employer-release-2026-10-11.md`)
| Product | Id | Price |
|---|---|---|
| AISE Tək vakansiya (30 gün) | `pdt_0NpVMcvyB0Ne5Nm4pfDQu` | one-time **20 AZN**, tax inclusive |
| AISE Biznes (aylıq) | `pdt_0NpVMd2J31Lv7mqwRdRxz` | **100 AZN** every 1 month, tax inclusive, contract length 10 years |

A no-charge live checkout preview returned totals of 2000 qəpik = 20.00 AZN and 10000 qəpik = 100.00 AZN, no tax added on top (tax is included in the price). They become purchasable only when `DODO_PRODUCT_ID_EMPLOYER_SINGLE` / `DODO_PRODUCT_ID_EMPLOYER_BUSINESS`, `EMPLOYER_PLANS_ENABLED`, `EMPLOYER_BILLING_ENABLED` and `PAYMENTS_ENABLED` are all set; none of them is set in production.

### Not verified (stated, not hidden)
* **No live-mode payment**: live products are created and read back, but no live charge or live subscription was made (by instruction). Live provider behaviour is the same API, but it is not demonstrated.
* **The hosted card form** of the provider was not operated by the agent; payments used a saved sandbox test card through the provider API with the same metadata the product sends. The page navigation to the hosted checkout was observed.
* **Real card-network failure flows** (renewal decline → `on_hold`) were covered for candidate subscriptions on 7 October; for Biznes the failed state was exercised with cancellation and with a stored `on_hold` status in the fake-provider e2e, not with a declining card.
* **No human reviewed the Azerbaijani copy** of the plan screens; the wording is plain and consistent with the server rules but is not a native-reader approval.
* Operator moderation by two different people, email notification of review outcomes, invoices/receipts and VAT reporting are not built or tested (the provider is merchant of record for tax and invoices).
