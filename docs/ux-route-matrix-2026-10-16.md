# Route-by-route UX check (16 October 2026)

Automated sweep of the real web app (Next dev server) against a locally built API and a fresh migrated database, with synthetic accounts: anonymous visitor, a new candidate, and an onboarded candidate (LinkedIn PDF fixture imported through the UI). Each route at 375 px and 1280 px. Checks: HTTP status and redirect, horizontal overflow, one `h1`, visible form fields without a label, links/buttons without a name, images without `alt`, raw technical text (`undefined`, `NaN`, `[object Object]`, `statusCode`, `TypeError`, internal errors) and console errors.

This is a mechanical check, not a design review: it does not judge wording, visual hierarchy, contrast or keyboard order. Employer protected pages and admin pages were only checked for their redirect (no synthetic employer or admin session), and pages that need specific data (a document, an application, a company) were not opened.

| Area | Route | 375 / 1280 | Before | After |
|---|---|---|---|---|
| Public | `/`, `/about`, `/pricing`, `/jobs`, `/companies`, `/contact` | pass | pass | pass |
| Legal | `/legal`, `/terms`, `/privacy`, `/privacy/requests`, `/refund`, `/acceptable-use`, `/employer-terms`, `/application-authorization` | pass | pass | pass |
| Legal | `/cookies`, `/service-providers` | pass | table overflowed the page at 375 px (72 / 158 px) | table scrolls inside a labelled region |
| Auth | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email` | pass | no `h1` (title was `h2`) | `h1` |
| Employer auth | `/business/login`, `/business/register`, `/business/forgot-password` | pass | no `h1`; 3 unlabelled fields on register | `h1`; fields labelled, autocomplete hints |
| Redirects | `/dashboard` → `/login`, `/business/dashboard` → `/business/login`, `/checkout` → `/register` | pass | pass | pass |
| Candidate | `/dashboard`, `/dashboard/matches`, `/dashboard/saved`, `/dashboard/companies`, `/dashboard/resumes`, `/dashboard/applications`, `/dashboard/email-applications/settings`, `/dashboard/notifications`, `/dashboard/settings` | pass | pass | pass |
| Candidate | `/dashboard/profile` | pass | each delete button (one per role/school) had no name and a ~24 px target | named, 44 px |
| Candidate | `/dashboard/agent` | pass | three application routes not distinguished; "agent" naming | routes explained side by side; "Brauzer köməkçisi" |
| Candidate | `/dashboard/agent/campaigns/new` | pass | no `h1` when the assistant is off | `h1` |
| Candidate | `/dashboard/volunteering` | pass | switch had no accessible name | labelled by its heading (the sweep's heuristic still counts it) |
| Candidate | `/dashboard/applications/tracker` | pass | one flagged button | false positive: “Sütun əlavə et” has text inside a collapsed panel |
| Onboarding | `/dashboard/profile?onboarding=true` with LinkedIn PDF | pass | see `docs/linkedin-import-2026-10-16.md` | preview, edit, save, reopen verified |

No route showed raw technical text, overflow (after the fixes) or console errors. Rapid navigation hit the local API rate limit (429) on two pages during the first run; with a pause between pages none appeared. That is expected throttling, but pages should explain a 429 rather than stay empty; not changed here.
