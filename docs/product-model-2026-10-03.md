# AISE product model and entitlements (3 October 2026)

Status: **proposal.** Specification version `2026-10-03.1`, source of truth `packages/shared-types/src/product-spec.ts`. Every number is a provisional choice for the founder to confirm. **No price is set**: until `PRODUCT_CONFIG_JSON` configures one, an offer cannot be purchased. `PAYMENTS_ENABLED` stays false in every real environment; everything here was exercised against a local fake provider only.

## What exists and was reused (no second billing, notification, application or entitlement system)
- `Subscription` + `PlanOverride` + `effectivePlan()` (billing/entitlement.ts) remain the only way to decide a plan. Dodo checkout, the signed webhook (`BillingWebhookEvent` idempotency), `syncSubscription` (reads the provider's current state, so replays and out-of-order events are safe), cancellation and failed-renewal handling are the existing implementation, extended with one plan.
- Added, additively: enum value `SubscriptionPlan.PREMIUM`, table `UsageCounter` (migration `20261013090000_product_entitlements`; applied only to the isolated local database).
- Legacy plans BASIC / STANDARD / Limitsiz keep their meaning (match quota, tailoring included per match, digests, multiple base CVs for Limitsiz). No record was changed or reinterpreted. The new retention features (saved jobs, searches, follows, instant alerts) are additive for them.

## Candidate offers
| | Free | Premium (the one new offer) |
|---|---|---|
| Public discovery, application tracking, basic profile/CV tools, in-app alerts, daily e-mail digest | yes | yes |
| Saved jobs / saved searches / company follows | 200 / 3 / 20 | 1,000 / 20 / 100 |
| Instant alerts | no | yes, bounded (10 a day) |
| CV versions | 1 base CV | 5 |
| Tailored CV | current behaviour kept (included per match) | metered, 20 a month (proposal, costly, configurable) |
| Tailored cover letter | no | metered, 20 a month, **planned** (not built) |
| Richer preferences, advanced application preparation | no | yes (preparation is **planned**) |
Premium never promises interviews, hiring, unrestricted external auto-apply or unlimited provider usage (`never` list in the spec; a test scans the catalogue for forbidden claims).
Open product decision, deliberately **not** switched on: moving tailored CVs for Free users behind Premium would remove something existing users have today. Tailored CVs are counted (shadow metering) but not limited by this spec.

## Employer offers (specification and catalogue only; employer billing does not exist)
Starter/trial (1 active native vacancy, bounded review), single paid job, recurring business package (posting allowance, team seats), enterprise (configured per contract), optional promoted listing (must be visibly labelled "Promosyon"). Candidate discovery/contact by employers is **off** for every offer: it needs an explicit candidate-consented workflow that does not exist, and imported CVs are never exposed or sold (`invariants.importedCvExposure = never`). None of these is purchasable; the catalogue says why.

## Configuration
`PRODUCT_CONFIG_JSON`, e.g. `{"prices":{"PREMIUM":12},"limits":{"candidate.premium.tailored.cv":25}}`. Prices are positive numbers (AZN); limits are integers ≥ 0 or null; unknown keys or bad values stop the API at startup. A real provider key with a Premium price also requires `DODO_PRODUCT_ID_PREMIUM`. The API and web read effective values from `GET /billing/catalogue` and `GET /billing/entitlements`; they must not copy numbers into screens.

## Metering
`UsageCounter` rows per user, feature key and period; `consume` increments and checks the limit in one SQL statement (20 concurrent requests with a limit of 3 grant exactly 3, tested); `record` counts without refusing. Rows are removed with the account (cascade, tested).

## Verification (local, isolated synthetic data)
Unit: spec invariants, config validation, Premium eligibility (billing specs 50 pass). e2e `product-entitlements` (6): catalogue defaults and operator overrides, owner isolation and 401, checkout cannot be bypassed (plan taken from the server's own product id, a forged claim grants nothing), signed activation, replay applied once, failed renewal and cancellation back to FREE, atomic metering, cascade on deletion. The existing `billing-lifecycle` e2e continues to cover the legacy lifecycle.

## Not done / external inputs
Prices, a Premium product in the Dodo dashboard and `DODO_PRODUCT_ID_PREMIUM`; the founder's decision on moving tailoring behind Premium; employer billing; the candidate-consent workflow for employer discovery; cover-letter generation. See `docs/frontend-contract-2026-10-03.md` for what screens may rely on.
