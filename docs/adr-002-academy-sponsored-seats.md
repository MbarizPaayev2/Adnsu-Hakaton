# ADR 002: Academy sponsored candidate access

**Status:** Implemented as an operator-provisioned pilot foundation; no academy checkout or consumer price change.
**Date:** 2026-10-26

## Context and existing entitlement model

Candidate access is resolved by `apps/api/src/billing/entitlement.ts`. Dodo subscriptions are stored in `Subscription`; temporary platform-admin grants use `PlanOverride`. Every feature gate derives limits from the existing plan catalogue and usage ledgers. Academy reporting consent is separate from candidate access.

The existing operator override had no academy identity, capacity, seat binding or cohort deduplication, and a more recent override could downgrade a paid personal plan. Academy staff must never provision paid access. The institution's proposed 400 AZN / 30-seat package remains a commercial proposal and is not sold or enabled by this implementation.

## Decision

- One `AcademySponsorship` record per academy sets a platform-provisioned `PLUS` or `PREMIUM` plan, seat capacity, active start and end, and provisioning admin.
- A `AcademySeatGrant` binds one verified AISE account to one academy until the program end. It is created only for a current active or graduated cohort member. A second cohort membership in that academy does not consume another seat.
- Provisioning endpoints require the dedicated `academy.sponsorship` platform permission, an ADMIN or SUPER_ADMIN role, and a verified MFA session; they write `AdminAuditLog` entries. Academy staff roles have no sponsorship or plan-grant endpoints.
- Grant claims lock the sponsorship row before checking active seat count, so concurrent claims cannot overrun capacity. Repeated grant for the same account is idempotent. Revocation marks the grant and linked PlanOverride revoked atomically; it leaves the account, application history and outcome data intact.
- The linked `PlanOverride` preserves compatibility with all current feature gates and usage ledgers. A normal operator override still takes precedence. Otherwise, the effective plan is the highest active sponsored or personally paid plan. Quotas are resolved once from that plan and are never summed. Sponsor grants are independent of academy analytics consent.
- Student settings show academy name, sponsored plan, expiry and the account's current daily match remainder. Documents, email and browser-agent usage continue to use the existing metering services; there is no parallel allowance ledger.

## Provisioning path

A platform admin with `users.plan` provisions the current pilot through `POST /admin/academies/:academyId/sponsorship` with plan, seat capacity, start and end. The start must be active now; the end is bounded by the admin's approved pilot agreement. The operator can inspect seat utilization through `GET /admin/academies/:academyId/sponsorship`; academy members can see the same privacy-safe capacity summary through `GET /academies/:academyId/sponsorship`, with no student-level records. The operator can grant one seat with `POST /admin/academies/:academyId/sponsorship/grants` (`userId`), and revoke a seat with `DELETE /admin/academies/:academyId/sponsorship/grants/:grantId`. This is an internal provisioning workflow, not a self-serve academy UI or invoice/payment claim.

## Rollback

Migration is additive. Rollback can disable the admin routes and stop issuing grants; existing candidate accounts and application history remain. To revoke access for a specific student, use the audited revoke route. Do not drop sponsor tables while active linked PlanOverrides exist; first revoke the grants or use a reviewed data migration. Consumer subscriptions and existing usage rows are not modified.

## Verification boundaries

The implementation must be verified with concurrent local PostgreSQL seat claims, duplicate grants, same student across multiple cohorts, active personal-plan precedence, expiry/revocation, and revoked analytics consent. No production academy or candidate is provisioned by this change.
