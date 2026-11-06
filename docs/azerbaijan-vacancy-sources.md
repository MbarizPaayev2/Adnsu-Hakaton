# Azerbaijani vacancy collection

Implementation checkpoint: 1 October 2026. This work is separate from release PR #12 and is not deployed. It adds validated Hellojob and ABB career-page adapters, not a complete inventory of Azerbaijani vacancies.

The later employer expansion and all 100 target statuses are recorded in [the employer coverage checkpoint](employer-source-coverage-2026-10-01.md). That branch adds SOCAR, Azercell, PwC, EY and Halliburton adapters; most employer targets are still not integrated.

## How Glorri currently works

The existing hourly BullMQ collector reads Glorri's public JSON listing endpoint, follows its pages, then extracts individual job pages with Cheerio. It refreshes jobs through `JobsService.upsertJob`, which maintains stable identities, applies conservative cross-source deduplication and queues eligible jobs for matching. No model or GPU is used for collection. The Glorri schedule and adapter are unchanged here.

## New Hellojob adapter

The new collector reads public vacancy pages at `https://www.hellojob.az/vakansiyalar` and follows their next-page links. It extracts the title, employer, description, labelled city, posting date and deadline from each vacancy page. The original URL is retained. Azerbaijani dates are converted with Baku's UTC+4 offset; a deadline includes the end of its stated day.

Jobs have an external identity `hellojob:<slug>`. The `--apply` path posts to AISE's existing service-token-protected `/internal/jobs/ingest` endpoint. It does not write directly to the database or introduce a migration. Generic job rows already have a matching-service payload and a “Mənbəyə bax” link in the candidate interface.

Repeat imports preserve job identity. The existing queue key suppresses duplicate matching work. Cross-source duplicate postings remain as linked rows, rather than being deleted. Expired deadlines are refreshed too, so an old future deadline does not remain active; expired jobs are excluded from matching. Removed pages or missing deadlines still require further lifecycle work: this collector does not infer closures from absence, caps or failed requests.

The collector does not visit CV pools, account pages or hidden contact endpoints, and does not submit applications. A source integration for vacancies does not provide external auto-apply support.

## Direct employer source: ABB careers

The ABB vacancy page explicitly references its public JSON listing route `https://careers.abb-bank.az/api/vacancy/v2/get`. The new `abb` adapter follows the observed consecutive pagination contract and retains source IDs, original detail/application links, publication dates and application deadlines. It includes only public, active, already-open postings, and refreshes expired deadlines. It never visits registration or application endpoints.

Cities are taken only from an explicit recognized city suffix in the job title. When the public feed supplies no city, the location remains country-only (`Azerbaijan`), not an invented Bakı. This currently affects 77 of the 104 feed rows. More city mappings can be added when backed by source evidence. HTML descriptions become plain text; scripts/forms are removed. Inconsistent pagination, a changed total during collection, invalid data and access restrictions are reported rather than silently counted as complete.

Preview from `apps/api`:

```sh
npm run script:import-public-jobs -- --source abb --max-pages 12 --max-jobs 120 --delay-ms 1500
```

The same CLI's explicit `--apply` mode uses the existing guarded loopback import API. No separate dependency, model, migration or automatic schedule is added. The complete read-only preview on 1 October returned **104 rows over 11 pages, 44 expired, 60 non-expired, zero parsing failures**. These are feed rows, not 60 verified additional unique jobs: cross-source overlap is checked when actually imported. No live ABB jobs were written locally or to production.

## Source findings

Read-only observations from this Mac on 1 October 2026:

| Source | Current result | Next step |
| --- | --- | --- |
| Glorri | Existing collector and hourly schedule | Keep current behaviour; partnership work remains separate |
| Hellojob | Public listings and detail pages readable; robots allows crawling | Review adapter and source attribution/republishing arrangements, then rehearse a bounded import before scheduling |
| Boss.az | Direct home/robots requests returned HTTP 403 here | Establish supported access or an approved feed; no bypass added |
| eJob.az | Direct home/robots requests returned HTTP 403 here | Establish supported access or an approved feed; no bypass added |
| Jobsearch.az | Robots has `User-agent: *` and `Disallow: /` | Obtain an approved feed or collection permission; no adapter enabled |
| busy.az | Not added | Resolve previously identified copying restrictions first |
| ABB careers | Public JSON feed; robots allows access; adapter verified | Review bounded import and attribution before scheduling |
| Bir careers | HRX links to `https://careers.bir.az/vacancies/8455`; HTML is an application shell, including at `/robots.txt` | Find a supported public listing contract and clarify crawler rules; no adapter or bypass |
| LinkedIn | HRX Dataspecta listing links to a LinkedIn job | Original source confirmed; no automated collector added |
| SOCAR careers | Old portal request failed; current `jobs.socar.az` works in the later employer branch | New preview extracted 34 jobs; see employer coverage checkpoint |
| BirJob | Current `/terms` requires written agreement for bulk republication; `/llms.txt` describes a public top-50 assistant feed | Obtain a company agreement, rather than clone its complete catalogue |
| Other employers' career pages | Coverage not complete | Add separately validated adapters and measure freshness |

References: [ABB vacancies](https://careers.abb-bank.az/vakansiyalar), [ABB robots](https://careers.abb-bank.az/robots.txt), [BirJob terms](https://www.birjob.com/terms), [HRX sampled Bir listing](https://hrx.az/is-elanlari/proqramlasdirma/enterprise-architect/enterprise-architect-bir-0f7e51), [HRX sampled Dataspecta listing](https://hrx.az/is-elanlari/proqramlasdirma/qa-muhendis/senior-ai-qa-evaluation-engineer-dataspecta-779883), [Hellojob listings](https://www.hellojob.az/vakansiyalar), [Hellojob robots](https://www.hellojob.az/robots.txt), [Hellojob rules](https://www.hellojob.az/page/qaydalar), [Jobsearch robots](https://jobsearch.az/robots.txt), [HRX Upstream Source Map (2026-10-04)](hrx-upstream-source-map-2026-10-04.md). A robots allowance is not a republishing agreement. Hellojob's rules restrict third-party sharing of its candidate CV database; this adapter collects vacancy pages only. A 403 here does not establish that a site prohibits every form of integration.

## Bounded operation

From `apps/api`, preview is the default and needs no service token:

```sh
npm run script:import-public-jobs -- --source hellojob --max-pages 1 --max-jobs 3 --delay-ms 1500
```

Once the API containing this code is built and released, an operator can run a bounded import inside its container using the existing environment. With the repository's Compose `api` service, for example:

```sh
docker compose exec -T api node dist/scripts/import-public-jobs.js --source hellojob --max-pages 3 --max-jobs 50 --delay-ms 1500 --apply
```

`SCRAPER_SERVICE_TOKEN` must already be present in that process's environment. Do not put it in shell history or documentation. The destination defaults to `http://127.0.0.1:4000`; `AISE_INGEST_API_URL` can override it with another loopback HTTP origin. Redirects from the ingest endpoint are refused so they cannot forward the token.

**Source lease (since the vacancy-automation integration).** `--apply` now works only while it holds the source's lease: it takes it from the API (`POST /internal/jobs/source-lease`, same service token), renews it while it works and releases it at the end, so it can never overlap the scheduler or an operator's "İndi işlət" for the same source. If another process holds the source the command stops and says who ("source is being collected by another process"); wait or use the admin to see the run. The preview (no `--apply`) takes no lease and writes nothing. The import routes themselves refuse writes for collector sources without a valid lease (HTTP 409), so a custom script that posts to `/internal/jobs/ingest`, `confirm-listed` or `import-runs` for a source such as `work`, `hellojob`, `boss`, `abb` must be changed to take the lease first, or use this command. Glorri (own importer) and sources without a reviewed collector are not gated.

By default no cron or repeatable queue job runs: this remains an explicitly invoked operator command, and deploying the code alone starts no new source traffic. The optional scheduler (`SOURCE_SCHEDULE_ENABLED=true`, plus `scheduled=true` per source in the admin) is OFF unless a deployment enables it; see `docs/source-scheduling-automation-2026-10-04.md`. The `import.glorri` switch governs Glorri only; `import.scheduled` is the global pause of the scheduler.

Limits: default 3 pages, 50 detail pages, 1.5 seconds between source requests; maximum 200 listing pages and 10,000 details. Limits are ceilings, not claimed source totals. A capped run reports `complete: false`. Increasing them can make a run last hours, and does not guarantee comprehensive coverage. Requests have a 20-second timeout and 2 MiB response ceiling. A lock prevents overlapping runs on the same filesystem. After a crash, inspect the PID in the temporary lock before manually removing a stale lock; separate containers do not share this lock unless their temporary directory is shared.

The run checks robots before visiting listings/details and stops on blocked access, rate limiting or an import API failure. It does not rotate proxies, impersonate browsers, solve challenges or retry around restrictions. Changed/empty layouts are reported as incomplete rather than proof all jobs disappeared. Parsed invalid details are counted and omitted. The final report distinguishes discovered links, fetched details, expired postings, parse failures and accepted imports/previews.

## Verification completed

- API typecheck and TypeScript compilation passed. The compiled CLI loads and rejects an unsupported source before requesting any page. A Docker image build is not included in this check.
- Four focused unit/HTTP-boundary suites: **81 tests passed**. Coverage includes synthetic parsing, Baku dates, pagination, duplicate cards, unsafe URLs, robots restrictions, source failure, expiry, authenticated HTTP import, redirect rejection, invalid acknowledgements, and the existing ingestion/deduplication units.
- New isolated integration suite: **5 tests passed** against the existing local `aise_phase2_test` database. It uses real Nest HTTP, the service-token guard, validation, `JobsService` and Postgres. It proves parsed field persistence, repeat identity/queue keys, cross-source linking and expiry refresh. Source HTML and the matching queue are synthetic; no model, email or external site is called. Only the suite's own two synthetic job identities are removed afterwards. No reset or schema change was performed.
- Read-only live Hellojob preview: **80 links discovered, 3 details parsed, 0 parse failures**. Intentionally capped and incomplete. No live job was imported into local or production storage.
- Whitespace check passed. No new dependency, credential or environment file was added.

## Additional ABB verification

- Four focused unit/HTTP/ingestion suites: **91 tests passed**, including ABB calendar/time-zone handling, explicit city evidence, public-status filtering, consecutive pagination, caps, robots restrictions, access failures and redirect/content-type validation.
- Expanded real Nest/HTTP/Postgres integration suite: **8 tests passed**. ABB original fields persist through the guarded import route, repeated collection preserves the row and matching queue key, and an expired deadline prevents new matching work. Source responses and queue are synthetic; only this suite's own three job identities are removed.
- API typecheck passed. Shared HTTP transport retains the existing Hellojob bounds and origin checks.
- After the final identity/visibility validation tightening (covered by units), the integration rerun was **blocked**: Docker stopped and the local Postgres port disappeared. All eight checks failed at the database connection precondition; no application assertion ran. The earlier eight-test pass is retained with that limitation. Docker was not restarted and unrelated projects were not touched.

## Remaining work

Build/release the reviewed API code, rehearse small actual Hellojob and ABB imports with production operational safeguards, and verify those jobs in the candidate UI before increasing coverage. Observe failures and expiry over successive runs before adding a schedule. Keep source links and attribution, and clarify source arrangements where necessary.

Broader coverage needs more source-specific adapters, supported access for restricted sites, employer feeds, and an inventory measuring coverage and freshness. Do not advertise “all Azerbaijan vacancies” from this implementation. Telegram preference notifications and external application automation are separate tasks and are not implemented by this collector.
