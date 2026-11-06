# Employer purchases: refund policy and operational handling (11 October 2026)

Status: **policy text published in the product (Abunəlik, ləğvetmə və geri ödəniş → İşəgötürən planları, `/refund#isegoturen`, and `/employer-terms` §10); operational handling implemented and tested (sandbox/fake provider).** The commercial terms in the policy are a proposal prepared for the founder to confirm; until the founder says otherwise they are the rules the operational handling implements. Nothing here promises hiring outcomes.

## What Dodo Payments requires (checked 11 October from Dodo's published pages)
* Dodo is the **merchant of record**: it processes payments, taxes and refunds for AISE; refunds are initiated **by AISE through the API or the dashboard**, with a status per refund; tax adjustments follow automatically.
* Refund and dispute rates are monitored signals of a merchant account; **if a merchant does not respond to a refund request within "reasonable timelines", refunds may be processed automatically and the account restricted or closed.** Hence the response times below (2 business days to acknowledge, 5 to decide — the same as the candidate refund page).
* Dodo does not prescribe the content of a merchant's refund policy; the policy must be clear, published before purchase, and consistent with the checkout. No refund window is imposed by Dodo.

## The policy (what a customer is told)
| Situation | Rule |
|---|---|
| **Unused purchase** (Tək vakansiya credit not yet used for a vacancy) | Full refund on request within **14 calendar days** of payment; afterwards still considered case by case. The credit is cancelled. |
| **Undelivered publication** (AISE's technical failure or error: not published, or not publicly visible for part of the paid period) | The lost time is added to the listing, or — employer's choice — a full refund; the listing is then withdrawn. Company profile and received applications stay. |
| **Published and displayed listing** | No refund for change of mind, few applications, or no hire; AISE promises no hiring outcome. A listing taken down for breaking the posting rules is not a refund reason. Statutory rights are unaffected. |
| **Biznes cancellation** | Cancel any time; active until the end of the paid period; no further charge; no pro-rata refund for the current period. If **no vacancy was published** within 14 days of the first payment, the first payment is refunded in full. |
| **Platform failure** (duplicate or erroneous charge; payment taken but credit or subscription not granted; charge after cancellation) | Refunded in full or corrected. A failed payment grants nothing and takes no money. |
| **After expiry, cancellation or refund** | Company profile and existing application records remain accessible. |
| **How** | Write to the billing address with the company e-mail and payment number (never card data). Acknowledged within 2 business days, decided within 5; refunded to the original payment method through Dodo; bank processing time does not extend AISE's obligation. |

## Operational handling (implemented)
* **Operator action:** `POST /admin/employer-purchases/:id/refund {reason, endListing?}` (permission `payments.refund`, SUPER_ADMIN/ADMIN, MFA session required; the reason is mandatory and written to the audit log whether the request succeeds or is refused). List: `GET /admin/employer-purchases?status=` (admin page *İşəgötürən ödənişləri*).
* **Order of operations:** the purchase moves `PAID → REFUND_PENDING` and an unspent credit `AVAILABLE → VOIDED` in one transaction **before** the provider is asked, so the credit cannot be spent meanwhile and two clicks/operators cannot send two refunds; then `refunds.create(payment_id, reason)`.
* **Provider unreachable or refusing:** purchase back to `PAID`, credit back to `AVAILABLE`, nothing lost; the operator sees the failure.
* **Provider confirms** (create response or the signed `refund.succeeded` webhook, **re-fetched from the provider**, never trusted from the payload): `REFUNDED`; a credit already used for a published listing requires `endListing: true` (platform failure) — the listing becomes `EXPIRED` with reason `REFUNDED`, applications untouched. Duplicate deliveries are no-ops.
* **Refund made in the provider's dashboard** (not through AISE): the same webhook brings the purchase, credit and listing in step.
* **Subscription payments** (Biznes) are refunded in the provider's dashboard; their `refund.*` events are recognised as not belonging to a single-listing purchase and left alone. Cancellation and failed renewals are handled by the subscription lifecycle (docs/employer-plans-2026-10-11.md §3).
* **Tests:** unused refund (credit voided before money moves, cannot be spent, refund applied once under duplicate webhooks), provider refusal and outage restore the credit, delivered listing needs the explicit withdrawal flag, unpaid/reason/permission guards (`apps/api/test/employer-plans.e2e-spec.ts`, 21 tests) and the admin page (`employer-purchases.spec.tsx`).

## Not decided / not built
* The 14-day window and the "no pro-rata" rule are proposals for the founder; change the text and `LEGAL.refundWindowDays` together.
* Partial refunds, a self-service refund button for employers, and automatic extension of a listing after an outage are not built (the operator extends by hand: a free credit is not created automatically).
