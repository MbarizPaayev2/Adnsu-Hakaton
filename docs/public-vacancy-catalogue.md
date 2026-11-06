# Public vacancy catalogue and source expansion

## Scope

`/jobs` lists every eligible stored posting independently of account, CV, subscription, or personalized match quota. Imported postings and approved employers' native vacancies share one paginated catalogue. `/dashboard/matches` remains the personalized view.

The catalogue filters category, city, title/company and source, and sorts by posting date. Fifteen title-based categories provide an inexpensive first classification; these are browsing heuristics, not employer-confirmed classifications. Unknown titles remain visible in Other. Bakı/Baki/Baku aliases are supported. Closed, hidden, expired and linked duplicate imported postings are excluded; native vacancies require an approved employer and active, unexpired status. No source payloads, CVs or private employer fields are returned.

Imported details link to the original application page. Native details link to the existing authenticated AISE application journey. Listing a vacancy does not mean an application was submitted, and stored open status does not prove an employer has not filled a position.

This change requires the PR #12 schema, including `duplicateOfId`. It does not deploy that schema or enable a collector. Hellojob collection is separately reviewed in PR #13.

## Observed production inventory

Read-only aggregate query at 2026-10-01 13:23 UTC / 17:23 Baku:

- 1,257 stored Glorri jobs; 1,147 active/unhidden jobs with no expired deadline.
- 103 expired and 7 explicitly closed.
- Two native vacancies stored; zero currently eligible for public browsing.
- Latest Glorri observation: 13:00 UTC / 17:00 Baku.
- Production does not yet have the PR #12 deduplication columns. The counts above do not assert cross-source uniqueness.

Never use this snapshot as a hardcoded website counter. The new API calculates counts from eligible rows.

## Source discovery (public pages only)

Checked 2026-10-01. Discovery is separate from integration and commercial republication permission.

| Source | Observed route | Status |
| --- | --- | --- |
| Glorri | Existing AISE importer | Running production source; left unchanged |
| Hellojob | https://www.hellojob.az/vakansiyalar | Collector prepared in PR #13, not deployed/scheduled |
| ABB careers | https://careers.abb-bank.az/vakansiyalar | Page exposes its public JSON listing route `/api/vacancy/v2/get`; first response reports 104 rows over 11 pages. Original details, begin/end dates and public status are provided. Candidate for a bounded adapter; not imported by this catalogue change |
| Bir careers | https://careers.bir.az/vacancies | Confirmed original destination from an HRX Enterprise Architect listing; public response is an app shell. Needs an independently observed public listing contract and access review |
| LinkedIn | Public Dataspecta job link from HRX | Confirmed outbound destination; no scraping/automation integration added |
| SOCAR careers | https://careers.socar.az/vacancyInfo?type=1 | Official portal found through search, direct request failed here; no adapter or bypass |
| BirJob | https://www.birjob.com/terms and `/llms.txt` | Current terms require written agreement for bulk republication and say programmatic API access is not offered. Public assistant feed advertises only 50 jobs; it is not a licence to copy the whole catalogue. No jobs imported |
| Boss / eJob | Public job boards | Direct requests returned 403 in this environment; not bypassed |
| Jobsearch | Public job board | robots.txt disallows crawling; not collected |
| busy.az | Public job board | Previously identified copying restriction; not added |

HRX is useful for discovering original public destinations, not as a replacement licence or a database to clone. Its sampled Dataspecta link resolves through a public `/kecid/` page to LinkedIn; its Bir Enterprise Architect link resolves to `https://careers.bir.az/vacancies/8455`.

National coverage requires an explicit source register, bounded collectors, timestamps, deadline/status refresh and deduplication. Do not claim all Azerbaijani vacancies are covered. No outbound partner messages or candidate applications were sent.

## Verification

- 16 real-Postgres catalogue API tests passed in the existing isolated local test database. Own synthetic fixtures removed; no reset, migration or replacement of existing rows.
- 12 catalogue web tests and 5 existing UX tests passed.
- Real Nest/Postgres/Next/installed Chrome rehearsal passed: unauthenticated pagination, retained filters, category/city search, original source and native application links, and no horizontal overflow at 390/768/1440 px. Screenshots inspected. No source request or application submission in the browser rehearsal.
- API TypeScript passed after the browser correction. Web TypeScript passed before running Next, but the repeated check after Next generated dev types fails on the unchanged NextAuth route exporting `authOptions` (route handlers may not export that property). This existing release issue is not a catalogue test failure; a full release typecheck is not claimed as passing.
- New web files lint clean. Dashboard navigation retains its two pre-existing `no-explicit-any` findings; this change adds only a link there.

Rehearsal command from repository root: `node node_modules/ts-node/dist/bin.js --transpile-only --project apps/api/tsconfig.json scripts/job-catalogue-browser.ts`. Uses only loopback database `aise_phase2_test` on port 5433, catalogue API 4020 and Next 3460; starts no importer/email/matching workers. Chrome path is overridable with `CHROME_PATH`. Logs/screenshots stay outside Git.

No merge, deployment, production write or scheduled import is included.
