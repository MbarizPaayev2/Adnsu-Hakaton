# Azerbaijan vacancy-source review — 26 October 2026

This review checks the strategic intelligence report against current public pages and the collectors already in AISE. A source appearing in a strategy report is a lead, not evidence that a job is open, that an employer uses a claimed address, or that AISE may republish its data.

## Big Four and consulting

| Employer/source | What is verified now | AISE status / decision |
| --- | --- | --- |
| PwC Azerbaijan | Current Azerbaijan-specific careers search is hosted on PwC's Phenom portal. | Existing `pwc` collector; keep it. |
| EY Azerbaijan | Baku-filtered SuccessFactors career search is already represented in `SAP_SOURCES.ey`. | Existing collector; keep it. |
| Deloitte Azerbaijan | Official local careers page exists. The report's `recruitment@deloitte.az` direct-apply claim and required subject format were not verified on an official vacancy page. | Keep public listings found through already-supported sources; do not set up direct email dispatch from this address without job-level instructions. |
| KPMG Azerbaijan / regional board | The local KPMG vacancy page and the KPMG Caucasus & Central Asia Huntflow board are distinct. The regional public board currently lists Baku roles and its robots file permits public vacancy paths. No link from the local KPMG careers page to Huntflow, terms granting republication, or `hr@kpmg.az` job-specific instructions were verified. | Added a Baku-only regional-board collector as `kpmg-cca`. Daily collection does not reconcile closures, because the board has a “show more” control. Clearly labels the source as KPMG Caucasus and Central Asia; application remains external. |
| McKinsey | The official page for Fellow Business Analyst, job 104471, currently identifies Baku and gives role requirements. The report's reference to this role is currently valid, but a stable, public, enumerable Azerbaijan search feed was not verified. | Track as a candidate for a targeted official-page monitor. No brittle single-job-ID collector added. |
| BCG | The official career search currently exposes Baku results, including IT Service Intern (job 60089); current search facets show Azerbaijan/Baku roles. The public Phenom results are paginated and the stable supported filter/query for Azerbaijan was not established in this pass. | High-priority reusable Phenom connector candidate. Do not scrape dozens of global result pages to find a small local set. |
| Bain | No local hiring source was verified in this pass. | No collector. |

## Recruitment agencies and confidential employers

| Source | Current evidence | Decision |
| --- | --- | --- |
| FireWorks HRM | Its public vacancies page currently shows a Baku Legal Manager opening. The page describes a separate general talent-pool form; it does not establish a role-specific application address or destination. robots.txt permits ordinary public-page access; no terms permitting database reuse were found. | Do not claim email application or bind the role to an unnamed client. Revisit after confirming a role-specific destination, freshness/closure signal, and publisher terms. |
| HRC Baku | Public vacancy pages are crawlable, but the current rendered/search-index page includes many listings dated 2024–January 2026 and has no sufficiently reliable current-open signal for a scheduled feed. | Do not ingest stale roles or infer they are open. Ask publisher for a feed or confirm live-status behavior before building a collector. |
| AZINKA | Current site search shows a listed Rabita Bank operations vacancy dated 4 May 2023; the `/vakansiyalar` URL from the report was not confirmed and the site returned server errors during direct checks. | Reject as a live source until its site and current vacancies are restored and verified. |
| GRC Leadership Consulting | robots.txt is accessible, but the report's `/vacancies` path returns not found and no public vacancy feed was established. | No collector. |

Blind or confidential employers must remain named as “Confidential employer (via [agency])” unless the vacancy itself identifies the employer. An agency's general contact or talent-pool address is not treated as a vacancy-specific application channel.

## Public job-board access decisions

The report's JobSearch.az, Banker.az and Facemark.az leads can be evaluated as independent source candidates. Do not use automated extraction where published terms prohibit it: Busy.az terms restrict unauthorized extraction for database building; Work.az's user agreement prohibits collection by bots; CyberJob's agreement prohibits automated tools. robots.txt alone does not grant a content-reuse licence. Keep source attribution, original links and removal controls for any permitted public listing.

## Collection and product constraints

- Ingest only roles whose location is explicitly Azerbaijan; do not infer Baku from an employer's presence.
- Preserve original vacancy URLs and publisher attribution.
- Never fabricate posting dates. If only first observation is available, store that basis and do not present it as the publisher's posting date.
- Never infer closure from a bounded or incomplete crawl.
- Do not configure direct email application from a company-level contact address. Require vacancy-specific application instructions and candidate approval.
- Prioritize a BCG Phenom query/filter discovery and a stable McKinsey public feed next; both have verified Baku demand, while a global page crawl would waste requests and import irrelevant roles.
