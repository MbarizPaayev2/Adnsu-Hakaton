# Frontend contract — backend checkpoints 1–6 (4 October 2026)

For the frontend worker. Everything below is implemented, tested and pushed on `codex/vacancy-email-applications`; nothing is deployed. The preview must keep working as it does today: the existing employer workspace, `/resumes/*`, `/email-applications/*` and `/billing/*` routes are unchanged in meaning (new fields are additive). Authenticated candidate routes use the session bearer token; **owner-only: another account's id answers 404, never 403**. Errors are `{statusCode, message}`; refusals that the UI must branch on carry a stable `code`.

Detail documents: `career-evidence-2026-10-04.md`, `documents-and-allowances-2026-10-04.md`, `email-application-letters-and-rechecks-2026-10-04.md`, `vacancy-coverage-and-company-pages-2026-10-04.md`, `admin-recommended-actions-2026-10-04.md`.

## 1. Plans, prices, document allowance (shows up in `/billing/catalogue` and `/billing/entitlements`)
* Offers: `free`, `plus`, `premium`, plus the legacy plans (unchanged). Prices come from the catalogue (`price`, AZN a month): **Plus 8, Premium 15**; never hard-code them. `purchasable` is `false` until a payment product is mapped — show the plan, show the price, **do not offer checkout when `purchasable` is false** (checkout answers 503). Payments are not active.
* Feature `documents.generations`: Free `limit 5`, Plus `30`, Premium and legacy plans `limit: null` (**no monthly cap** — say "no monthly limit", never "unlimited provider usage"; `protections {concurrent:3, perHour:30}` are the only limits and are to be displayed as such). `period: 'month'`; entitlements adds `used, reserved, remaining (null = no cap), periodKey, resetsAt` (UTC instant; the month resets at midnight **Baku time**: render it in Asia/Baku, for example "resets 1 November 00:00").
* One successfully generated document = one generation; a CV plus a letter = 2. Editing, previewing, approving and downloading an existing document is free. A failed generation costs nothing. A running generation temporarily counts (`reserved`).

## 2. Documents (new) — CV, concise resume, motivation letter
`kind`: `CV` (fuller), `RESUME` (concise), `LETTER`. Languages `az|en|ru|tr`. States: `PENDING` → `NEEDS_REVIEW` (draft, no file) → `READY` (explicitly approved, PDF exists) or `FAILED`.

| Route | Cost | Notes |
|---|---|---|
| `GET /documents/allowance` | free | `{plan, limit|null, used, reserved, remaining|null, period, resetsAt, protections|null, costs:{perDocument:1, cvAndLetter:2}}` |
| `POST /documents/quote` `{matchId, items:[{kind, language?}]}` | free | `{units, affordable, refusal|null, items[{kind, language, alreadyRunning}], detectedLanguage, allowance, remainingAfter}`. **Show this cost before the candidate generates a bundle.** CV+RESUME together is a 400 (choose one). |
| `POST /documents/generate` `{matchId, items, expectedUnits, requestId?, letter?:{motivation?≤2000, storyIds?}}` | `units` | Send the `units` you showed as `expectedUnits`: a different real cost → `409 {code:'COST_MISMATCH', expectedUnits, actualUnits}` and nothing is created. `201 {bundleId, created, unitsReserved, documents[], allowance}`. Send a `requestId` (8–64 chars) so a double click or retry returns the same documents without a second charge. |
| `GET /documents?matchId=&kind=` | free | newest first: `{id, kind, language, status, statusError, bundleId, matchId, version, createdAt, reviewedAt, fileUrl|null}` |
| `GET /documents/:id` | free | adds `content`, `reviewNotes {issues[], revision}`, `provenance`, `letterInputs`, `snapshots[{id, revision, kind GENERATED|EDITED|APPROVED, contentHash, fileSha256|null, createdAt}]`, `allowance {status RESERVED|COMMITTED|REFUNDED, period}`, `posting` |
| `PATCH /documents/:id/review` | free | CV/RESUME: `headline, summary, experience[{highlights}], skills[], projects|activities|awards|certifications|languages[{entryId, description?}]`. LETTER: `paragraphs: [{id?, text, approved?}]` (the full list, 1–5). Editing an approved document returns it to `NEEDS_REVIEW` and withdraws its file. |
| `POST /documents/:id/approve` | free | produces the PDF; response is the detail with `fileUrl` and an `APPROVED` snapshot |
| `POST /documents/:id/regenerate` `{expectedUnits:1, language?, requestId?, letter?}` | 1 | new document (`provenance.parentId`); the old one and its approval stay. Letter paragraphs marked `approved` are kept word for word. |
| `GET /documents/:id/preview` | free | `application/pdf`, `no-store`. Draft = same bytes the approval will produce; after approval = the approved file. Use it in an `<iframe>`/object with the bearer token (fetch as blob). |

Refusals: `402 {code:'ALLOWANCE_EXHAUSTED', limit, used, reserved, remaining, requested, resetsAt}` (show the reset time), `429 {code:'CONCURRENCY_LIMIT', concurrent, running}` / `{code:'HOURLY_LIMIT', perHour, startedLastHour}` (say "try again in a moment", not "limit reached for the month"), `409 COST_MISMATCH`, `400` for bad bundles/story ids. A `FAILED` document shows `statusError` (it ends with a code such as `(INVALID_OUTPUT)`); say that **nothing was deducted**.
UX requirements: the `reviewNotes.issues` list shows what the fact check removed (owner-only; severity `error` = removed); the candidate must press approve — never auto-approve; show language and format on the card; letters need the vacancy's own match (`matchId`); **never show another document's id from a different match**.
Existing `POST /resumes/tailor`, `/resumes/:id/review`, `/resumes/:id/approve` keep working (one CV item through the same pipeline).

## 3. Career evidence (checkpoint 1; unchanged)
`GET/POST/PATCH/DELETE /profile/career-entries…` — see `career-evidence-2026-10-04.md`. Only `CONFIRMED` entries reach documents; STORY entries are letter-only material (`letter.storyIds` takes their ids).

## 4. E-mail applications (additions)
* `POST /email-applications/prepare {jobId, resumeId?, letterId?}` and `PATCH /:id/draft {letterId | removeLetter, …}`: `letterId` is an approved `LETTER` document made for **this** vacancy. Refusal messages end with a code: `LETTER_NOT_APPROVED`, `LETTER_WRONG_JOB`, `WRONG_DOCUMENT_KIND`, `LETTER_CHANGED` (409 at approval: the letter changed after the preview, re-open the preview), `CV_CHANGED`, `PREVIEW_STALE`. Eligibility reason `LISTING_STALE` is new (the listing has not been seen by any import for 30 days).
* The view now has `cv`, `letter|null`, `attachments[{role:'cv'|'letter', fileName, mimeType, sha256, bytes, resumeId}]`, `recipientEvidence {excerpt, subjectLine?, reference?, sourceUrl, observedAt, listedAt}` — **show the recipient, the quoted wording, the source link and "last seen" date** next to the address — and `payloadSha256` (send it back on approve; it now covers the letter too). Download copies: `GET /:id/cv`, `GET /:id/letter`.
* `GET /email-applications/:id` adds `recruitment {state, evidence: 'PROVIDER_ACCEPTED'|'CANDIDATE_REPORTED'|'REPLY_CONFIRMED_BY_CANDIDATE'|null, employerConfirmed}`. Keep the labels apart: "handed to the e-mail service" (provider accepted), "delivered" (provider webhook), "you reported…", "from the employer's reply, confirmed by you". Never write "employer confirmed/viewed/interview/offer" unless `employerConfirmed` is true; provider events never imply them. An `UNCERTAIN` delivery is the candidate's decision (retry needs the explicit risk acknowledgement).
* New send-time failure codes in `failureCode`: `LISTING_STALE`, `DUPLICATE_APPLICATION`, `EMAIL_NOT_VERIFIED` (plus the existing ones).

## 5. Public company pages for collected employers (new, no session)
`GET /public/companies?q=&page=&limit=&sort=postings|name` → `{page, limit, total, totals:{companies, openPostings, postingsWithoutUsableCompanyName}, companies:[{id, name, openCount, lastObservedAt, sources[{key,name,count}], logo|null, monogram:{text,color}, registered:false}]}`
`GET /public/companies/:id?page=&limit=` → the same fields plus `aliases[], website|null, followKey, attribution {statement, sources[{key,name,homepageUrl,count}]}, total, jobs[{id, kind:'imported', title, location, postedAt, deadline, applicationMethod, checkedAt, source}]`. `GET /public/companies/:id/logo` serves an image.
Rules: `id` is stable (`oc_…`); **these are not registered AISE employers** — show `attribution.statement`, no "verified employer" mark, no contact details; a job opens through the existing `/jobs/imported/:id`. **Show a logo only when `logo` is non-null** (it carries source and source page — credit them); otherwise render `monogram` (`text` on `color`). `openCount` is the number of distinct open postings; `0` pages are reachable by id but not listed. Follow uses `followKey` with the existing company-follow routes.

## 6. Admin recommended actions (new)
`GET /admin/ops/recommendations` — contract and display rules in `admin-recommended-actions-2026-10-04.md`. Render `unknown` differently from `attention`, show `freshness`, never show "all clear" while a `checked[]` area is `unknown`, disable (do not hide) actions when `canAct` is false.
Admin plan overrides still list only the legacy plans; Plus/Premium overrides are not exposed in admin yet.

## 7. Integration order and what is not yet backed
1. Plans/allowance display (read-only) → 2. quote + generate + review/approve + preview → 3. regenerate and letter attachment in the e-mail flow → 4. public company pages → 5. admin recommendations.
Not available yet (do not build UI that implies it): payments for Plus/Premium, a logo collected for any company, employer verification of a collected company, document export formats other than PDF, admin controls for the new plans.
Real model quality is unmeasured (the provider in tests is a loopback fake): expect to review wording in a live trial before promising anything about quality.
