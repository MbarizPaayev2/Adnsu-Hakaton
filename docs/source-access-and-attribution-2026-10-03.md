# eJob.az and JobSearch.az: access and attribution requirements (3 October 2026)

Method: the sites' own pages were read on 2026-10-03 (robots.txt through the collector transport; privacy, about, contact and service pages through a general page reader that summarises each page — so quoted phrases are short and should be re-checked on the live page before any legal use). This is an engineering record, not legal advice. **robots.txt allowing a path is permission to crawl that path for our user agent, never permission to republish.**

## What the primary sources say

| Topic | eJob.az | JobSearch.az (classic.jobsearch.az; jobsearch.az) |
|---|---|---|
| robots.txt | `User-agent: *` disallows only `/pdf/`, `/cpdf/`, `/clear/`, `/edit/`, cabinet, message and upload paths (and their `/ru/`, `/en/` variants). Separate groups ask `GPTBot`, `OAI-SearchBot`, `ClaudeBot` for `Crawl-delay: 5`. Sitemap: `/sitemap/sitemap.xml`. | `User-agent: *` has `Crawl-delay: 30` and `Disallow: /unsu`; a `Yandex` group carries a `Host` directive. Sitemap on `jobsearch.az`. |
| Terms of use / rules page | **None linked.** Footer: Privacy (`/privacy/`), About (`/about/`), Feedback (`/feedback/`). The privacy page mentions "rules" (qaydalar) shown on a form page but gives no link. | **None published.** Footer of the classic site: About, Services, Contact. The main site's footer: About, Contact. No terms, privacy or content-reuse page found. |
| Copyright | "© eJob.az, 2013–2026 — Bütün hüquqlar qorunur" (all rights reserved). | "© JobSearch.az 2006—2026". |
| Automated access | The privacy policy states the site applies technical measures to protect data from automatic collection ("parsing"). | Not stated beyond the crawl-delay. |
| Reuse / republication / attribution | **No permission or licence stated; no attribution requirement stated.** | **No permission or licence stated; no attribution requirement stated.** |
| Content responsibility | Administration "bears no responsibility" for posted listings; listings are moderated before publication (for errors/readability). | Employers may hide their company name in a posting (Services page). |
| Contact for permission | Contact form `/feedback/` (complaints without contact details are not reviewed). | Contact page: an e-mail (obfuscated on the page), three landline and two mobile numbers, an office address in Baku. |
| Application contact | Contact details shown as an image / message form (the message path is disallowed in robots.txt). | The apply address is revealed by script on click and is not in the static page. |

## Conclusions and the policy applied
1. **Neither site grants a licence to copy, aggregate or republish its vacancies.** Absence of a prohibition is not a grant; eJob additionally says all rights are reserved and that it takes technical measures against automated collection. Written permission from each owner is required before any production import or public display. Attribution requirements are unknown until permission terms exist; the safe baseline once permitted is a visible source name, a link to the original posting, and no removal of the original apply route.
2. **What is allowed meanwhile:** bounded, paced, read-only previews and local trials on disposable data (what this work did), with crawler rules and delays honoured and every restriction (403/429/blocks) stopping the run.
3. **Enforced in code, not only in documents:** migration `20261015090000_hold_ejob_jobsearch_pending_permission` sets `enabled=false` for both sources. The ingestion API refuses postings from a disabled source (`assertIngestable`), so no environment that has applied the migration can import them; the e2e spec `new-public-sources` proves the 403. Both stay `scheduled=false` and `ROBOTS_ALLOWED_TERMS_PENDING`; the collectors never report a complete listing, so they cannot close postings. Enabling a source is a deliberate operator action after written permission is recorded in the source's access note.
4. **Employer identity:** JobSearch lets employers hide their name, so some postings legitimately have no employer; those are rejected by the parser (a posting without an employer is not stored), never given an invented one.

## What is needed from the owners
Written permission naming: the data we may store and display (title, employer, location, description, dates), whether full descriptions may be shown or only a summary and link, required attribution wording and link, refresh and removal obligations (how fast a withdrawn listing must disappear), rate limits or a feed/API they prefer over crawling, and whether candidates may be sent to the original apply route only.
