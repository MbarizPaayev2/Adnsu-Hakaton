# Email application discovery — 21 October 2026

## Problem and resulting flow

Email applications are already configured in live mode, but the dashboard entry opens agent settings rather than a list of supported vacancies. Candidates can struggle to find the few email-accepting postings among the full catalogue.

The dashboard now has an `E-poçt müraciətləri` destination at `/dashboard/email-applications`. It lists open email-route vacancies, supports role/company search and employer selection, and links to the existing vacancy review/preparation action. Existing drafts and sending/agent settings remain one click away. There is no send action on the list page.

## Server filtering

`GET /jobs?application=email` selects imported postings with a published application email and non-null evidence, recent enough for the existing email-application freshness policy, and not present in EmailSuppression. Existing active/hidden/duplicate/deadline checks apply. Native/portal-only postings are excluded from this view.

Filtering precedes pagination and totals. Employer/source/category facets use the same email-only pool, so the employer selector does not advertise unsupported portal employers. The normal catalogue remains unchanged when the filter is absent. Public responses do not expose recipient addresses, stored email evidence or suppression details.

The list establishes a posting's available email route, not blanket support for all postings from that employer. Opening a job still rechecks eligibility; preparation, approval, quotas, sender verification, snapshots and dispatch are unchanged. No email address is guessed from a company name.

The generic jobs page preserves the application filter in form submissions, active-filter pills and pagination. Saved-search creation is hidden for this filter because the existing saved-search contract does not preserve application method.

## Read-only production snapshot

Observed 17 current email-address postings across 13 employers, before applying suppression filtering: NORM, Balli Bisi, EDU COMPANY, Academor, Avrora, LLG, Luxe Life Group, AzProtein Foods Group, Light viza, Signaltake, FZ Academy, Voxera Solutions and Ateshgah Sigorta. Counts can change with imports and deadlines.

Production master switch, live transport and real-recipient delivery permission were already enabled. The provider key, sender and webhook were configured. A provider domain-inspection request returned `restricted_api_key` because the key permits sending only; this is not evidence that the key is invalid, nor does it independently verify domain readiness or delivery. No message was sent during validation, and no production flags or candidate consent settings were changed.

## Verification

- Real isolated local Postgres catalogue E2E: 19/19 passed. The new case has 55 portal-only records preceding eligible email records; email filtering returns the three eligible records on the correct pages and excludes stale, missing-evidence and suppressed cases. Counts and employer facets agree. Fixture rows and the test suppression are removed afterwards.
- API: 130 suites / 2,018 tests passed; API build passed.
- Web: 97 files / 617 tests passed; web typecheck passed. New page/tests and shared catalogue helper lint clean.
- Actual page rendered with synthetic catalogue data and application CSS, inspected at 390px and 1440px. This component preview is not a deployed dashboard journey.
- No employer application, real-user notification or payment was made.

## Release boundary

Based on already released main f8d5889. No migration or new environment variable is required. This page/filter increment has not been deployed by this development step. Retain the existing release gates and verify a signed-in candidate can navigate to the list, filter by employer and reach the existing review action without sending anything automatically.
