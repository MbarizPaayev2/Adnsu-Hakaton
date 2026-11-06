# Career evidence: projects, volunteering, certifications, languages, awards, stories (checkpoint 1)

Path audited end to end: **upload → extraction → editable profile → generation input → factual validation → correction → export.** The two gaps found were real: `buildPersonaFromProfile` hard-coded `languages/projects/certifications` to empty arrays, and `tailor-facts.ts` cleared them again in `reconcileWithFacts` and `applyReviewEdits`. Both are fixed without weakening the fact checks (below).

## Data model (additive migrations `20261016090000_career_evidence`, `20261016090100_career_entry_date_precision`)
`CareerEntry` (keyed by user, so suggestions can exist before the profile is saved). Kinds: `PROJECT, VOLUNTEERING, LEADERSHIP, EXTRACURRICULAR, CERTIFICATION, LANGUAGE, AWARD, STORY, OTHER`.
- `status`: `SUGGESTED` (read from a document, nobody has confirmed it) → `CONFIRMED` (the candidate confirmed, corrected-and-confirmed or wrote it) / `HIDDEN`. **Only `CONFIRMED` entries ever reach generation.**
- `origin`: `EXTRACTED` | `USER_ADDED`. `confirmedAt`, `editedAt`, `sourceEvidence {resumeId, excerpt (original lines), extractedAt, parserVersion}` keep provenance.
- Everything except `title` is optional and stays `null` when the source does not say it: `organization, role, startDate, endDate, current, issuedAt, level (language fluency), description, result, situation, action (STORY), url, alwaysInclude, sortOrder`.
- `datePrecision` (`YEAR`|`MONTH`): a year-only date is never rendered as a month (a CV saying "2022" never becomes "Jan 2022").
Existing `Experience`/`Education` rows and the saved profile are unchanged and remain the only source of employers, positions, dates and degrees.

## Extraction (suggestions only)
`parseCareerSections` (in `cv-parser.ts`) reads the document's own Projects / Volunteering / Leadership / Extracurricular / Certifications / Awards / Languages sections. Nothing is composed: every stored text field occurs in the kept `evidence` lines (tested); no level, date, result or organisation is invented. Upload creates `SUGGESTED` rows idempotently: a re-upload never duplicates, never resurrects a hidden entry and never touches a confirmed or corrected one (a retitled entry is recognised by its source lines).

## API (owner-only; another account's id answers 404; all under the session bearer token)
| Route | Purpose |
|---|---|
| `GET /profile/career-entries?status=&kind=` | `{ entries: Entry[], counts: {suggested, confirmed, hidden} }` (counts always cover all of the user's entries) |
| `POST /profile/career-entries` | create (status `CONFIRMED`, origin `USER_ADDED`); `409 {existingId,status}` for a duplicate kind+title+organisation |
| `PATCH /profile/career-entries/:id` | edit fields (sets `editedAt`; status unchanged unless `status` is given) |
| `POST /profile/career-entries/:id/confirm` · `/hide` · `/restore` | state changes (`restore` returns to CONFIRMED if it ever was, else SUGGESTED) |
| `POST /profile/career-entries/review` `{confirm: id[], hide: id[]}` | bulk review in one transaction (any unknown/foreign id → 404, nothing changes) |
| `DELETE /profile/career-entries/:id` | user-added: deleted → `{removed:true}`; extracted: hidden → `{hidden:true}` so a re-upload does not bring it back |
Entry JSON: `id, kind, status, origin, title, organization, role, startDate, endDate, current, issuedAt, datePrecision, level, description, result, situation, action, url, alwaysInclude, sortOrder, confirmedAt, editedAt, evidence {excerpt, extractedAt} | null`. Validation (400): unknown kind; empty or >160-char title; end before start; `current` with an end date; non-http(s) `url`; oversized text (description 1500, result/situation/action 800).

## Generation and factual validation
- `selectCareerSections` decides which CONFIRMED entries fit a document: languages always; certifications and projects ranked by relevance to the vacancy then recency; **an experienced candidate (≥ 36 months of experience, overlaps counted once) is not given volunteering/leadership/extracurricular/awards unless they match the vacancy or the candidate set `alwaysInclude`**; early-career candidates get them. Stories are letter material only and never appear in a resume or CV.
- The fact corpus now includes the confirmed entries (so a rewritten sentence may use their facts and numbers, and only theirs). The model may reword a project's description; it is kept only if every sentence is supported by that candidate's facts. Projects, certifications, languages, activities and awards the model lists that are not confirmed entries are removed and reported (`invented_project`, `invented_certification`, `invented_language`, `invented_activity`). The prompt treats the persona and the vacancy as data; vacancy text that tries to give the model orders changes nothing (tested with a model that obeys it).
- Review (`PATCH /resumes/:id/review`) accepts `projects|activities|awards|certifications|languages: [{entryId, description?}]`: the list chooses which confirmed entries appear and in which order (omitting one drops it from this document only; one that is not a confirmed entry of this candidate, or is listed twice, is refused). Review sees all confirmed entries; generation sees the selected ones.
- The Harvard template renders projects (with organisation and stated result), volunteering & activities, awards, certifications and languages in the four supported languages.
- Later profile or career edits never rewrite an approved document or its file (tested byte for byte).

## Evidence
`test/career-evidence.e2e-spec.ts` (12 journeys over the real routes, BullMQ worker, fact checks and Typst PDF; synthetic people, loopback fake provider) and `src/resumes/career-sections.spec.ts` (8). Not covered: a screen-reader/UX review (frontend), real-provider writing quality.
