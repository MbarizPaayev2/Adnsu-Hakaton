# Vacancy source discovery — 2026-10-26

## HRX source model

HRX's public privacy page says some vacancies are aggregated from open job-search sites and company career pages. It does not expose a public upstream-source manifest. HRX is therefore useful as a discovery index for identifying employers and likely original links, but copying its catalogue would not establish source provenance, freshness, or permission. See [HRX privacy policy](https://hrx.az/privacy).

## Implemented: HRIN public board snapshot

- `hrin` is registered as a distinct public job-board source, not an employer.
- Collector reads `robots.txt`, `/vakansiyalar`, and matching `/vakansiya/{slug}-{id}` detail pages only. It never calls `/api`, candidate, employer-dashboard, admin, application, or CV/profile paths.
- Parses Schema.org `JobPosting` facts and checks listing/detail title, URL, canonical URL, and numeric ID agree. Foreign locations, malformed/future dates, incomplete records, and expired postings are not ingested.
- Uses the source crawl delay when supplied and a 1.5-second minimum between public page requests.
- The page is a bounded first-page snapshot; pagination and a complete active census are unverified. The collector always reports `complete: false` and cannot close vacancies based on absence.
- Source is enabled for operator preview/manual use but is **not scheduled**. Access review remains `ROBOTS_ALLOWED_TERMS_PENDING`; terms and republication/attribution review must be completed before scheduling.

Live read-only validation on 2026-10-26 parsed the first public listing card and its canonical detail page: `hrin:43426`, “Rəqəmsal Marketinq Mütəxəssisi”, Emsan, posted 2026-10-07, deadline 2026-11-06. No database import was run.

## User-nominated sources

| Source | Finding | Decision |
| --- | --- | --- |
| HRIN | Robots allows public `/vakansiyalar` and `/vakansiya/*`; `/api`, `/profil`, `/muracietlerim`, `/isegoturen`, and `/admin` are disallowed. Its service terms do not establish a partnership or republication license. | Added as a manual-only, explicitly attributed board source; terms review remains pending. |
| Royale Sea Breeze | The official apply page contains a “Motion Designer (LED Screens)” option, but no public vacancy detail, description, posting date, or current-status evidence was found. | Do not ingest a dropdown option as a vacancy. Use the employer link only when matched to a separately verified posting. |
| Sinteks careers | The public careers page is a client-rendered shell; robots disallows `/api/`. | No API scraping. Wait for a public feed, sitemap detail records, or explicit access path outside the disallowed route. |
| IRES | HRX exposes a company page with many role cards; IRES's public site did not expose a stable machine-readable career feed in this review. No provenance endpoint on HRX was found. | Do not infer these cards originate at IRES or copy them from HRX. Audit already-collected job-board listings against source URLs before adding an IRES adapter. |

## Verification

- New HRIN collector and cross-cutting registry/import/scheduler tests: 74 tests passed.
- API build: passed after building the local `@aise/shared-types` workspace package.
- One live read-only HRIN listing/detail contract test passed. No source import, merge, or production deployment was performed.
