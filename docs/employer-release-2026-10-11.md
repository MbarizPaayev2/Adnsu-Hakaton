# Employer plans: release record (11 October 2026)

What was deployed, which gates it passed, what each gate does **not** prove, and how to undo it.

## Live now
| | |
|---|---|
| Checkout | `fd3a87efe5a4113fd3e1af24d38a316d06e8d71f` (merge of PR #45; CI **success** on this exact commit; the PR head `c6234efe8` was green and its tree is the merged tree) |
| API image | `sha256:4f99b84eb495fb19bf65f543c1873de1db9bd1a718628d2555be2fc742ef9e5e`, revision label = the checkout, amd64, built once on the Mac, streamed with `docker save | gzip | docker load`, host id identical, provenance PASS |
| Web image | `sha256:f2ca03d7a32b2b1ded4ab9bfd320b115c1a36c512d08030a156e6c0ad1fb5076`, same procedure, provenance PASS |
| Scorer / apply worker | unchanged (`sha256:82a8565cf4c9…`) |
| Migrations | `20261022090000_employer_plans`, `20261023090000_employer_refunds` (additive; 52 migrations finished, none rolled back) |
| Switches | `EMPLOYER_PLANS_ENABLED=true`, `EMPLOYER_BILLING_ENABLED=true`, `PAYMENTS_ENABLED=true`; live product ids set. `EMPLOYER_VACANCY_AUTO_APPROVE` is **not** set: every employer vacancy waits for an operator in the review queue. |
| Verification | `verify-deployment.sh` with explicit image ids and `EXPECT_PAYMENTS/DOCUMENTS/AGENT/EMPLOYER_PLANS/EMPLOYER_BILLING=true`: all checks passed (also run once with both employer switches off before enabling). Host `check-health.sh`: restore test PASSED, no outbound e-mail failures, sources fresh. |
| Backup gate | set `20261011T124956Z` taken minutes before the deploy: off-host bucket VERIFIED, isolated restore PASSED against the schema of the deployed code (`6ecdcad`). |

Prices (stored in qəpik): Tək vakansiya **2000 qəpik = 20.00 AZN** for 30 days, no auto-renew; Biznes **10000 qəpik = 100.00 AZN** per month, unlimited genuine vacancies; first vacancy free for **14 days**, once per verified company. Company profile, logo, application inbox and stage management are in every offer and stay accessible after expiry. Vacancy boosts are **not** offered; "three seven-day boosts per month" is only a proposed future Biznes benefit (`packages/shared-types/src/product-spec.ts`).

## Gates
Both gates ran on the production host with the **exact release image** in a throwaway stack (own network, tmpfs Postgres, Redis); the live database was not written. Scripts: `scripts/employer-gates/`.

**Publication gate — 17/17** (`run-publication-gate.sh`, billing off): registration, verification, operator approval, login; public catalogue; overview shows trial available and checkout not available; operator-approved first vacancy publishes on the **14-day** trial (`expiresAt` = 14 days); listing public; second vacancy refused with `ENTITLEMENT_REQUIRED`; checkout refused while billing is off (no provider call); candidate applies during the trial; employer sees the application; after expiry a new application is refused, the received one stays stored, the company profile is still readable and the listing is no longer public; an unreviewed draft is not public.

**Payment gate — 8/8** (`run-payment-gate.sh`, **live** provider, nothing paid): the image created a live checkout session for each product; the purchase was recorded `PENDING` at 2000 qəpik / AZN with no credit granted; creating a session published nothing. The hosted pages were opened in a browser (no card data entered): *Tək vakansiya (30 gün)* **AZN 20.00**, VAT 0.00, total AZN 20.00; *Biznes (aylıq)* **AZN 100.00 / Month**, VAT 0.00, total AZN 100.00.

**Webhook checks (live):** one endpoint `https://aisehr.com/backend/webhooks/dodo`, enabled, all event types subscribed (so `payment.*`, `subscription.*` and `refund.*` arrive); the provider's signing secret and the host's `DODO_WEBHOOK_KEY` have the same SHA-256 (compared by hash prefix, neither printed); an unsigned POST and a POST with a wrong signature are both rejected with HTTP 400.

## What the gates do not prove
* **No live payment has ever been made for an employer product.** Grant-on-payment, renewal and refund were exercised against the Dodo **sandbox** (journey 35/35) and a fake provider (e2e), not against a live card. The first real purchase will be the first live proof; watch it (`/admin/employer-purchases`).
* **Currency presentation:** a hosted checkout opened from outside Azerbaijan first showed **USD $11.76** (adaptive currency, tax included) and switched to **AZN 20.00** when AZN was chosen; the AZN totals above are exact. Customers who pay in another currency pay a converted amount.
* The two checkout sessions and their synthetic customer records remain in the live provider account unpaid (they expire; nothing was charged).
* Operator moderation is one person (the founder's admin); no native reader reviewed the Azerbaijani plan wording.

## Roll back
```bash
# stop selling and gating (no deploy): both switches off, recreate only the API with the current release id
cd /srv/stacks/aise
scripts/host-config.sh flag EMPLOYER_BILLING_ENABLED false
scripts/host-config.sh flag EMPLOYER_PLANS_ENABLED false
RELEASE_SHA=fd3a87efe5a4113fd3e1af24d38a316d06e8d71f docker compose up -d --no-deps --no-build api
# previous code (the database is not rolled back: the new tables are additive and the old code does not read them)
RELEASE_SHA=6ecdcad5e10419097449e0ebd35d418678578311 scripts/rollback-images.sh 6ecdcad5e104 api web   # images aise-{api,web}:pre-6ecdcad5e104
```
Existing vacancies keep their status; `ACTIVE` plan vacancies still honour `expiresAt` with the switches off. Refund and entitlement rows are kept.

## Operating the refund policy
Public policy: `/refund#isegoturen`; operator procedure: `docs/employer-refund-policy-2026-10-11.md`. Refunds are requested by an admin with `payments.refund` and MFA at `/admin/employer-purchases`; the provider's own refund record is the truth (credit voided first, then `REFUND_PENDING → REFUNDED` from `refund.*` events). Nothing promises hiring outcomes.
