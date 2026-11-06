# LinkedIn Access and Vacancy Import Governance

**Reviewed:** 2026-10-27  
**Decision owner:** AISE product and legal review  
**Status:** Automated collection is not approved.

## Decision

AISE does not run the LinkedIn vacancy collector or server-side URL fetch by default. The `linkedin` source is registered for code and diagnostics, but its database row must remain disabled and unscheduled. Runtime ingestion additionally requires `accessReview = TERMS_REVIEWED_ALLOWED`. Direct URL reads require the separate `LINKEDIN_URL_READ_APPROVED=true` kill switch; collection requires `LINKEDIN_COLLECTION_APPROVED=true`. Do not set any gate based only on a successful HTTP response, a user request, or a public-page precedent.

## Primary-source evidence

- [LinkedIn robots.txt](https://www.linkedin.com/robots.txt) disallows `/jobs-guest/` paths for the general crawler. Robots rules are a technical signal, not a complete legal analysis.
- [LinkedIn User Agreement, Section 8.2](https://www.linkedin.com/legal/user-agreement) restricts scraping/copying through crawlers, browser plugins/add-ons, other technology, and unauthorized automated access. Re-check the live agreement before changing this decision; terms can change.
- [LinkedIn Talent Solutions Job Posting API overview](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview?view=li-lts-2026-04) describes an official partner product and application process. Availability and eligibility must be confirmed with LinkedIn; an API page is not itself an AISE grant of access.
- The [Ninth Circuit's hiQ v. LinkedIn opinion](https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/18/17-16783.pdf) addresses a preliminary-injunction dispute and U.S. Computer Fraud and Abuse Act questions around publicly accessible pages. It is not blanket authorization, does not override LinkedIn's contract terms, and does not decide AISE's obligations under Azerbaijani law or other applicable laws.

This is an engineering access decision, not legal advice. Obtain qualified legal review for commercial collection or any third-party data use.

## Permitted product path implemented here

1. A signed-in candidate may paste vacancy text they provide into `POST /jobs/parse-text`. Parsing is transient and does not publish or persist a shared `Job` record. If the candidate then asks AISE to prepare a document, the original text and their corrected fields are stored privately on that candidate-owned `Resume` record for review and regeneration; only the owner can read that context. It is not added to the shared vacancy catalogue.
2. The parser extracts only supported fields. Missing title, company, location, publication date, and deadline remain unknown and appear in `needsReview`; it does not assume Baku or invent dates.
3. An optional source URL is accepted only if it is a canonicalizable LinkedIn job URL. It is retained as provenance; the parser does not fetch it.
4. Application email extraction reuses the existing evidence-based `extractApplicationEmail` utility. An address is returned only when the text contains an application instruction; ambiguous or contact-only addresses are omitted.
5. `POST /jobs/extract-url` returns an explicit `ACCESS_REVIEW_PENDING` result while the separate approval gate is off. If a future approved request encounters an authwall or 401/403/429/999 response, it returns `AUTHWALL_OR_LOGIN_REQUIRED` with the paste-text recovery path. It does not use reader proxies or retry around the restriction.

User-pasted content is a candidate-directed workflow. It is not a claim that every use or downstream redistribution is legally permitted. AISE must not republish pasted postings without source rights and a separate review.

## Browser extension boundary

No LinkedIn host permission, content script, DOM reader, or session-cookie access is added to the AISE extension. A logged-in user's browser session does not turn prohibited extension scraping into an authorized integration. The extension must not read LinkedIn-rendered job pages or send their DOM to AISE unless LinkedIn provides express permission and legal/product review approves a narrowly scoped implementation. Existing browser assistance for other supported employers is unaffected.

## CLI diagnostic

`import-public-jobs.ts --source linkedin --check-direct-access` performs at most one bounded request to `https://www.linkedin.com/robots.txt` (5-second timeout and 256 KiB response cap), reports whether `/jobs-guest/` is disallowed, and exits without requesting a vacancy URL, acquiring a lease, collecting, retrying, or writing to the database. The output explicitly keeps automated fetching disabled regardless of HTTP status. Do not use this diagnostic to test around an access control.

## Conditions to revisit

Only revisit automated URL extraction or collection when all apply:

- LinkedIn provides written permission or an applicable official integration contract/API grant for the proposed exact use.
- Legal review checks the then-current User Agreement, robots rules, privacy obligations, data retention, geographic scope, and onward-use rights.
- Product records the approved scope, purpose, allowed fields, rate limits, retention period, and responsible contact in an auditable decision.
- Engineering adds source-specific access gates, rate limits, deletion/retention behavior, monitoring, and tests before any production enablement.
- The official integration (where available) is preferred over page scraping.
