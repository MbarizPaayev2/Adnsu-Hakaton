# Production continuation — 10 October 2026

PR #39 was merged as `829ebfe53a3fdc5794497db2070cb87947d45e01`. Its tree is identical to its CI-green code head `4cf5e86db34e4b1d18c5f959dad6e76a1393caef`. The API and web images built from that code head were deployed without rebuilding or touching matching, Postgres, Redis, the apply worker or other projects.

## Verification

- Exact code-head CI: push 38056061749 and PR 38056059160 passed. Local API: 85 suites / 1,357 tests; production build typecheck passed. Test-inclusive API typechecking still has previously recorded test typing errors.
- Isolated real-provider journey: phase A 78/78, phase B 5/5. Real API/Postgres/Redis/NVIDIA/Resend/PDF rendering; fixture matching and supplied portal forms/confirmation. This is not a live autonomous employer submission or an authenticated frontend browser journey.
- The first journey failed because its number check treated the system-generated date as candidate evidence. The corrected driver checks that date separately against today in UTC and still verifies all prose numbers without a blanket exception for years.
- Backup `20261010T194356Z`: R2 full archive/manifest read-back verified, copies on the founder Mac, isolated restore passed all five checks in 4 seconds. The evidence gate passed before deployment. Private credentials were not printed or committed.
- Deployment verification passed: API/web/scorer image IDs, 50 completed migrations, readiness, public/local HTTP, scorer authentication and self-test, expected switches and the importer state. The last hourly importer was PARTIAL; that is not a complete source census.
- Public Chromium verification: landing, jobs, pricing, employer login, candidate login and admin login at 320/390/768/1440px, 24/24 HTTP 200 with no horizontal overflow or page errors. The initial harness tested nonexistent `/business`; actual landing links point to `/business/register` and `/business/login`. Corrected route checks passed.
- Live analytics: zero Google requests before consent; page-view traffic after accepting; no search term or search event; token page produced zero collection hits and no token disclosure. A consented token page loads the Google script but sends no analytics event. The initial harness incorrectly counted the loader as a collection event.
- Updated web suite: 63 files / 409 tests passed; web TypeScript check passed.
- The host security checker previously hardcoded payments off. Its correction preserves that default but accepts an explicit `EXPECT_PAYMENTS=true` for the already-authorized paid rollout, rejects other expectation values, and still requires an exact runtime match. It does not change a production flag.

## Genuine application-email pilot

The founder confirmed earlier emails arrived. A new production canary used one synthetic candidate and job, two real generated/approved PDFs and only `ceo@aisehr.com` as recipient. Its first run stopped before sending because the harness tried to change a vacancy-required subject; the product correctly returned SUBJECT_LOCKED. The corrected run preserved the required subject and passed all 16 checks.

Resend's genuine `email.sent` (19:49:19 UTC) and `email.delivered` (19:49:21 UTC) events reached the public webhook and were applied to the same application. The application reached DELIVERED, and both PDF hashes matched the approved snapshots. No synthetic webhook event was sent to production. This proves recipient-server acceptance, not that an employer read the message.

The canary account was deleted through the product and its job removed. Read-only checks found zero remaining canary users and jobs. Private reports and synthetic PDFs are in `~/aise-preview/release-journey-20261010/` on the Mac and `/home/tefma/aise-codex-release-20261010/` on the host.

Candidate-approved email applications are now enabled with live transport and real recipients. Automatic email and inbound processing remain off. Source-stated addresses, document approval, exact payload consent, limits and suppression protections remain required. The measured catalogue currently has zero jobs explicitly classified with an application email; enabling the transport does not invent addresses or create more eligible destinations.

## Writer and document quality

`TAILOR_AZ_WRITER=true`; style demonstrations remain off because the development comparison did not establish a benefit. Letters require mechanical checks and a model fact-checker; rejected or unavailable writing falls back with a review warning. CV polish preserves source evidence on failure. Candidate review is still mandatory.

Two synthetic canary PDFs were rendered and visually inspected: no clipping, overlapping text or missing Azerbaijani glyphs. Their letter used the composed fallback, so this does not prove the new writer always succeeds or produces natural prose. Native-reader review remains open. The earlier eight-attempt comparison, 19 actual provider requests, used development-only synthetic cases, not founder personal facts or an independent holdout. No model was fine-tuned.

## Sources

SOCAR refreshed through the shared source lease. First bounded pass: one page, 10 fetched/accepted, 8 created, PARTIAL, no closures. Expanded bounded pass: four pages, 37 discovered/fetched, 13 accepted, 24 skipped, zero failures, two further creations, SUCCEEDED, no closures. Do not describe all 37 as accepted Azerbaijani jobs.

At 13:36 UTC the authoritative eligible catalogue had 1,363 postings and SOCAR 3. After these passes and concurrent scheduled activity it has 1,376 eligible postings, SOCAR 13. SOCAR contributes ten additional eligible postings; all thirteen catalogue changes cannot be attributed to that collector. Existing daily employer scheduling continues; no LinkedIn scraping, new board schedule or autonomous browser activation was introduced.

## Follow-up landing correction

The deployed landing initially hardcoded “Tezliklə” despite live generation. The correction reads `/billing/status` at request time with a two-second bound and no cache: confirmed on shows available CV/letters, off shows coming soon, and malformed/unavailable status shows unknown. No interview guarantee or Harvard endorsement was added. The employer and ABB sections retain their design. The web-only correction must receive exact-head CI, a provenance-checked build and a guarded web rollout before it is called live.

## Recovery and remaining human checks

API image: `sha256:84a0c53954e79ef25ff655526113b4eb9fda882e13c716933685890e83cfd78e` (code 4cf5e86). Initial web image: `sha256:1949628cba65169418c284080ddd845fc477aec2567f4ac60a0285ded520c85d` (same code). Scorer unchanged: `sha256:82a8565cf4c96c073d009bbc089c6205077b64ba840122a32fa4619383826ec8`.

The previous production images are kept as `aise-api:pre-0b86722c07e7` and `aise-web:pre-0b86722c07e7`. `scripts/rollback-images.sh 0b86722c07e7 api web` restores them; also restore the intended feature switches and release marker deliberately. Private pre-change environment copies are outside the host checkout. The existing local health fix matched the release byte-for-byte and was preserved before cleaning the checkout.

Admin password was already reset and is stored privately; it was not reset again. Founder MFA needs their authenticator code. The second admin was not disabled. Fully autonomous browser submission remains off until real portal evidence exists; current assisted-agent fixture checks are not that evidence.
