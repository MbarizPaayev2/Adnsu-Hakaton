# Document experience: verified backend state and contract requests (3 October 2026)

For Claude (backend owner). Written by the frontend worker on `codex/document-experience`, started from the frozen checkpoint `d6401a0ebbd54c18aae5c694fc8ddeaba1fb0ea8` (`codex/vacancy-email-applications`).

**Rule followed:** nothing below marked PROPOSED is wired to a live screen. Every shape in a PROPOSED block is a request, not a description of the backend. Until you confirm or amend a shape, the screen that needs it runs only in the labelled local preview (section 5) and is unavailable on every other host.

## 1. What the backend really does at this checkpoint (verified in code)

| Capability | Evidence | Status |
|---|---|---|
| Upload a base CV (PDF/DOCX, 10 MB) | `POST /resumes` (`resumes.controller.ts`) | LIVE |
| Edit parsed CV content | `PATCH /resumes/:id {parsedContent:any}` | LIVE, but body is unvalidated `any`; which keys survive is unspecified |
| Create a vacancy-tailored CV | `POST /resumes/tailor {matchId, baseResumeId?}` | LIVE (needs a **match**, not a free job id) |
| Review/edit the tailored draft | `GET /resumes/:id`, `PATCH /resumes/:id/review {headline?, summary?, experience[].highlights?, skills?}` | LIVE |
| Approve (creates the PDF) | `POST /resumes/:id/approve` | LIVE |
| Parsed CV fields | `Persona` in `resume-tailor.types.ts`: basics, summary, experience, education, skills, **languages, projects, certifications** | LIVE |
| Volunteering / leadership / extracurricular / awards in the parsed CV | not in `Persona` | **ABSENT** |
| Motivation (cover) letter generation | no route; `tailored.cover_letter` is `availability:'planned'` for every offer | **ABSENT** |
| "Resume" (short) vs "CV" (full) document kind | no concept; one Harvard-style template | **ABSENT** |
| Shared document-generation allowance | only `tailored.cv` (`limit:null` Free, `20/month` Premium) and `tailored.cover_letter` as separate planned keys; no `used/remaining` reset date for generations | **ABSENT** |
| Founder plans (Free 5 / 8 AZN 30 / 15 AZN unlimited) | catalogue has `free`, one `premium` (price unset), legacy plans; `PLAN_PRICES_AZN` is BASIC 5, STANDARD 10, Limitsiz 40 for the older *match* quotas | **NOT IN CATALOGUE** |
| Company pages | `GET /companies`, `GET /companies/:id` (ACTIVE, unexpired vacancies of APPROVED companies; stable ids; no logo field) | LIVE |
| Admin recommended actions / diagnostics | no route under `apps/api/src/admin` | **ABSENT** |

Consequences for the frontend:
- The new pricing numbers cannot be shown as live. The pricing screen keeps rendering whatever `GET /billing/catalogue` says; a plan the catalogue does not contain is not displayed as purchasable.
- A motivation letter cannot be offered as working. The landing says "Tezliklə" (coming soon) for it.
- The tailored-CV flow is wired to the real routes above and nothing else.

## 2. Wording constraints already agreed (not requests)
Use `PRODUCT_SPEC.positioning` strings (imported from `@aise/shared-types`) for the Harvard wording and keep `finePrintAz` beside it. No ATS claim, no interview promise or figure, no "unlimited AI".

## 3. PROPOSED contracts (please confirm or amend; none are wired)

### 3.1 Career evidence in the profile and parsed CV
```
GET /profile  and  parsed CV content gain optional arrays (each item carries provenance):
  volunteering:  [{id, organization, role, period, description, source:'EXTRACTED'|'USER', confirmed:boolean}]
  awards:        [{id, title, issuer, date, description, source, confirmed}]
  projects/certifications/languages: existing arrays, plus {id, source, confirmed}
GET /resumes/:id/extraction → {sections:{<key>:{status:'FOUND'|'NOT_FOUND'|'UNCERTAIN', count:number}}}
PUT /profile/evidence/:section/:id , DELETE , POST  (validated, length-bounded, owner-only)
```
Needed so the screen can say "found / not found / please confirm" without implying an empty section was extracted. An empty `NOT_FOUND` must stay distinguishable from "not parsed yet".

### 3.2 Document generation
```
POST /documents {kind:'RESUME'|'CV', jobRef, baseResumeId?, language:'az'|'en'|'ru'|'tr', optionalSections:string[]}
  → 202 {id, status:'QUEUED', cost:{generations:1}}
GET  /documents/:id → {id, kind, status:'QUEUED'|'DRAFT'|'APPROVED'|'FAILED', language, sections, previewText?, pdfAvailable:boolean, formats:['pdf'], failureReason?}
PATCH /documents/:id/review , POST /documents/:id/approve
GET  /documents/:id/file?format=pdf   (only formats listed in `formats`)
```
Open questions: should a RESUME/CV be created from a `jobRef` (`imported:<id>`/`native:<id>`) rather than a `matchId`? What is the section list for each kind?

### 3.3 Motivation letter
```
POST /documents/letters {jobRef, baseDocumentId, answers:{whyRole?, evidence:[{bulletId?, text, confirmedNumbers:boolean}], outcome?, extra?}}
  → {id, status, cost:{generations:1}}
GET /documents/letters/:id → {draft, evidenceUsed:[…], missingEvidence:[…], status}
PATCH …/review {draft}   POST …/approve
```
The service must report `missingEvidence` honestly and must not add numbers the user did not confirm (same fact check as `tailor-facts.ts`).

### 3.4 Shared allowance (entitlements)
```
GET /billing/entitlements → features['documents.generations'] =
  {enabled, limit:number|null, period:'month', used, remaining, resetsAt:ISO|null, availability}
Cost table the UI may display before submission: {RESUME:1, CV:1, LETTER:1}  (a CV plus a letter costs 2)
Failed generation must not increment `used`. Uploads, edits, downloads, exports never do.
```
`limit:null` is shown as "limit göstərilməyib", never as "unlimited", unless the catalogue wording says otherwise.

### 3.5 Catalogue
Founder-approved plans as catalogue offers with `purchasable` driven by the server and no provider product ids in the frontend. Until then the pricing page shows the existing catalogue only.

### 3.6 Admin recommended actions
```
GET /admin/ops/recommendations → [{id, severity:'info'|'attention'|'critical', title, why, evidenceAt:ISO, stale:boolean, suggestedStep, href?}]
```
`href` only to existing admin pages. No retry or destructive actions. Unknown health must come back as its own state.

### 3.7 Company discovery
Existing `/companies` is sufficient for lists, counts and follow-by-id. Missing: a source-attribution field per vacancy list (which source a catalogue vacancy came from) and a `verifiedPartner:boolean` that is false for scraped companies. Logos: none exist, so the monogram is the only honest image.

## 4. What the frontend ships without any new contract
- Landing additions (candidate-benefit section with the letter marked "Tezliklə", separate employer section linking to the real registration and workspace).
- The existing tailored-CV review kept as is; no new generation behaviour is invented.

## 5. Local development preview (explicit)
`NEXT_PUBLIC_DOCUMENTS_MODE=preview` is honoured only on an allowlisted local host in a non-production build, the same gate as the retention fixtures (`isLocalQaHost`). Every preview screen shows a persistent banner "Yerli sınaq: backend inteqrasiyası tamamlanmayıb" and generated content is plainly synthetic. On `aisehr.com` or any other host the documents port is the `unavailable` adapter and the screens show "Hələ aktiv deyil".
