# Documents (CV, resume, motivation letter) and the monthly allowance — 4 October 2026

Backend checkpoints 2 and 3. Everything here is implemented and tested on disposable data; nothing was deployed, no payment was activated and no real message was sent.

## Approved product rules (founder, 4 October 2026)

| Plan | Document generations a month |
|---|---|
| Free | 5 |
| Plus (8 AZN a month) | 30 |
| Premium (15 AZN a month) | no monthly cap |
| Legacy Basic / Standard / Limitsiz | no monthly cap, as before |

- CVs, resumes and motivation letters share one allowance. A successfully generated document uses **one** generation; a CV plus a letter uses two.
- Uploading, reviewing, editing, previewing, approving, downloading and exporting an existing document costs nothing.
- A failed generation never consumes a unit. Deleting a document that was generated does not give its unit back (otherwise delete-and-regenerate would be a free loop); deleting one that is still running does.
- Premium and legacy plans have **no hidden monthly cap**. They have two transparent protections, published in the catalogue (`protections` on the `documents.generations` feature): at most **3 generations running at once** and **30 started per hour**. A generation that failed because of the platform (provider down, queue down, lost worker) does not count towards the hourly protection.
- Prices come from the commercial catalogue (`packages/shared-types/src/product-spec.ts`: `defaultPrice` Plus 8, Premium 15). Both are purchasable **only** when the payment provider has a product mapped for them (`DODO_PRODUCT_ID_PLUS` / `DODO_PRODUCT_ID_PREMIUM`) or when running in local mock mode. Payments remain disabled until the existing provider/sandbox release gates are passed. Existing subscriptions are untouched.
- The old daily ceiling of 10 tailored CVs per 24 hours is now only applied when an operator sets `TAILOR_DAILY_LIMIT`; the approved allowance plus the protections replace it (otherwise Premium would have had a hidden cap of 10 a day).

## The allowance is a ledger (`DocumentCharge`)

`RESERVED` when a generation request is accepted → `COMMITTED` in the same transaction that stores the generated draft → or `REFUNDED` when the generation fails, is abandoned or its reservation expires.

* **Period.** The calendar month in Baku (UTC+4, no daylight saving). Every account uses the same period key (`2026-10`) and resets at the same instant, shown to the candidate as `resetsAt` (midnight at the start of the next Baku month, as a UTC timestamp). A generation is charged to the period in which it was accepted.
* **Atomicity.** Creating the PENDING rows and reserving their units is one transaction under a per-account Postgres advisory lock (`resume-tailor:<user>` then `doc-allowance:<user>`), so concurrent requests, double submits and several API processes cannot exceed the limit. A bundle that does not fit is refused as a whole (nothing partial is created).
* **Reads count what is committed plus what is running** (unexpired reservations), so the number shown is the number that can still be started.
* **No stranded reservations.** A reservation expires after 20 minutes (longer than the 15-minute stale-draft window). A lazy sweep, run on every read and every reservation, refunds reservations whose draft FAILED, whose row was deleted, or that expired. A worker that finishes after its row was failed or deleted finds no PENDING row, stores nothing and counts nothing.
* **Idempotency.** An optional `requestId` makes a replay (double click, retry after a network error) return the same documents without a second charge. Without it, a request for a document of the same kind and match that is already running returns the running one. Charges are keyed by document id (unique), so the same document can never be charged twice.
* **Bundle accuracy.** `POST /documents/generate` requires `expectedUnits` (what the candidate was shown). If the real cost differs (for example one of the documents is already running) the request is refused with `409 COST_MISMATCH { expectedUnits, actualUnits }` and nothing is created.
* **Separate from other quotas.** Match quotas (`PLAN_MATCH_QUOTAS`) and application quotas are untouched. The older `tailored.cv` / `tailored.cover_letter` per-match counters remain as shadow metering only.

## Documents

One table (`Resume`) with `docKind`: `CV` (fuller, all confirmed certifications/projects/activities), `RESUME` (concise: at most 4 highlights per role, two projects, relevant certifications only) and `LETTER` (job-specific motivation letter). All render on the real Harvard-style Typst templates (`resume-harvard.typ`, new `letter-harvard.typ`) with the same font, so Azerbaijani, Russian, English and Turkish render correctly.

* **Language.** Per item (`az|en|ru|tr`); default is a detection from the vacancy text (a heuristic, shown in the quote, never a fact). The requested language wins over whatever the model reports. Salutation, closing, signature and recipient of a letter are fixed text, never model output.
* **Facts.** Every document is built from the candidate's saved profile and **confirmed** career entries only. Letters may also use the candidate's confirmed stories and the motivation text they typed (counted as their own words). Every generated sentence is checked against that corpus (numbers, capitalised names, acronyms, alphabet); unsupported sentences are removed and listed in `reviewNotes.issues` for the owner. The vacancy supports no claim except the employer's own name, the position title and the place.
* **Vacancy and uploads are data.** The model prompt says so, the fact check does not trust model compliance (tested with an obedient model that follows an instruction hidden in the vacancy), and only a reference plus a SHA-256 of the vacancy text is stored in `provenance` — never the vacancy text.
* **Review and explicit approval.** Generation produces a draft in `NEEDS_REVIEW` with no file. The candidate previews (`GET /documents/:id/preview`), edits (`PATCH /documents/:id/review`; for letters the full paragraph list, 1–5 paragraphs, each optionally `approved`), and approves (`POST /documents/:id/approve`). Only approval produces the stored PDF. Editing an approved document returns it to review and withdraws its file until it is approved again.
* **Preview equals download.** The draft preview is rendered by the same function that renders the approved file; once approved, the preview serves the stored file itself. Rendering is deterministic (tested: identical SHA-256 for preview, repeated preview and the approved file).
* **Versioned snapshots.** `DocumentSnapshot` is append-only: `GENERATED` (revision 0), `EDITED` (each save), `APPROVED` (with the SHA-256 of the exact PDF). Each carries a content hash. `GET /documents/:id` lists them with the provenance (vacancy reference + text hash, career entry ids used, language, template version, parent document, generator model and call count).
* **Regeneration.** `POST /documents/:id/regenerate` is a new generation (costs one unit, `expectedUnits: 1`), creates a new document that points at its parent, and leaves the earlier document and any approval untouched until the candidate approves the new draft. For letters, paragraphs marked `approved` are kept word for word at their position; the other slots take newly generated, fact-checked text.
* **Ownership.** Every route is owner-only; another candidate's document id answers 404.

## API (all authenticated; owner-only)

| Method and path | Cost | Purpose |
|---|---|---|
| `GET /documents/allowance` | free | `{ plan, limit|null, used, reserved, remaining|null, period, resetsAt, protections|null, costs }` |
| `POST /documents/quote` `{ matchId, items:[{kind,language?}] }` | free | units, whether affordable, refusal reason, detected language, remaining after |
| `POST /documents/generate` `{ matchId, items, expectedUnits, requestId?, letter?:{motivation?,storyIds?} }` | 1 unit per new document | creates PENDING documents and reserves units; `201 { bundleId, created, unitsReserved, documents[], allowance }` |
| `GET /documents?matchId=&kind=` | free | the candidate's documents, newest first |
| `GET /documents/:id` | free | status, content, provenance, snapshots, charge status, posting |
| `PATCH /documents/:id/review` | free | edits (CV/resume sections as before; letters: `paragraphs`) |
| `POST /documents/:id/approve` | free | produces the PDF and the APPROVED snapshot |
| `POST /documents/:id/regenerate` `{ expectedUnits:1, language?, letter? }` | 1 unit | new draft |
| `GET /documents/:id/preview` | free | `application/pdf`, `Cache-Control: private, no-store` |
| `GET /billing/entitlements` | free | now includes `documents.generations` with `used`, `reserved`, `remaining`, `periodKey`, `resetsAt`, `protections` |

Refusals: `402 ALLOWANCE_EXHAUSTED { limit, used, reserved, remaining, requested, resetsAt }`, `429 CONCURRENCY_LIMIT { concurrent, running, requested }`, `429 HOURLY_LIMIT { perHour, startedLastHour, requested }`, `409 COST_MISMATCH { expectedUnits, actualUnits }`. The original `POST /resumes/tailor`, `/resumes/:id/review|approve` endpoints keep working (they are the same pipeline with one CV item).

## Verification (disposable database `aise_phase2_test`, unique Redis queue prefix per process, loopback fake provider)

* Unit: allowance period boundaries (Baku midnight, year rollover, leap February), language detection, letter reconciliation and edits (unsupported claims, vacancy cannot support a claim, approved paragraphs kept, five-paragraph cap), processor commit/refund behaviour.
* `test/documents.e2e-spec.ts` (20 tests, real routes, BullMQ worker, Typst, Postgres): quote writes nothing; bundle `COST_MISMATCH`; reserve then commit; factual letter with provenance and GENERATED snapshot; invented employer/metric/tool removed and a letter with nothing factual FAILS with a refund; prompt-injection in the vacancy followed by an obedient model; requested language; resume vs CV prompts; preview == approved file == APPROVED snapshot hash; free edit/approve with versioned snapshots; regeneration keeping approved paragraphs; owner isolation; **eight parallel generations on Free → exactly five accepted, three `402`**; free actions after exhaustion and the month rollover; double-submit and `requestId` replay → one charge; Plus 30th accepted / 31st refused; Premium no cap with 3-concurrent and 30-per-hour protections (platform failures excluded); legacy plan no cap; queue-unavailable refund; lost worker refund and a late worker counting nothing; delete semantics; no document text, model output or credential in logs.
* Migration `20261017090000_documents_and_allowances` (additive: three enums, `PLUS` plan value, five nullable/defaulted `Resume` columns, two tables) applied to a fresh database and to a database at the previous state holding a legacy Limitsiz subscription and CV rows: rows kept (`docKind` defaults to `CV`), no drift against `schema.prisma`.

## Not verified / honest limits

* Writing quality and provider cost of real model output are **not** measured: the provider is a deterministic loopback fake. Live NVIDIA acceptance is untested.
* Language detection is a heuristic; the candidate can always choose the language.
* The document PDFs are rendered by Typst; visual layout was checked through extracted text and fonts, not by a human reviewer for every language.
* Payments: Plus and Premium are listed with their approved prices and are not purchasable in production until a provider product is mapped and the release gates pass.
