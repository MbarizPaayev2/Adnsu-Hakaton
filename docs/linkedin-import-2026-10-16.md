# LinkedIn and CV import accuracy (16 October 2026)

## What changed

- **LinkedIn "Save to PDF" exports** are read by their own structure (`apps/api/src/resumes/linkedin-import.ts`). The PDF reader (`extractPdfLayout`) reads the main column first on every page and the sidebar after it, and keeps each line's font size. Company and school names are set larger than body text in the export, so they mark entry boundaries; without sizes (pasted text) the reader falls back to text cues.
- Fixed, with fixtures: a wrapped headline lost the name and put the About sentence in the headline (and the name became an award); the next employer's roles were credited to the previous one; an undated school swallowed the following schools; wrapped bullets were split; wrapped certificate names were split (with geometry) or joined with a stray space at a hyphen.
- **Text copied from the profile page** (screen-reader repeats, buttons, pronouns, "Title / Company · Full-time / Mar 2024 - Present · 1 yr 8 mos", "Issued Mar 2023" certificates) is read too.
- **Page furniture** ("Page 2 of 3", a repeated running header/footer) is removed for every PDF, keeping the first occurrence of a repeated line. Ordinary CV parsing is otherwise unchanged; its full test suite passes.
- **Dates keep their precision.** Year-only dates are stored as 1 January with `startPrecision/endPrecision = YEAR` and shown as the year. Undated education stays undated (`Education.startDate` is now nullable). The profile page no longer saves a missing start date as today; a role still needs a start date, but the year alone is accepted.
- **Review before merging.** Text and PDF imports return a preview listing new and already-present entries and the fields the reader could not determine, with the source lines. Nothing changes until "Profilə əlavə et"; existing values are not overwritten. A LinkedIn PDF goes to `POST /resumes/import-file`, which stores nothing and no longer replaces the candidate's base CV file.
- The profile page no longer drops a role's location when saving.

## LinkedIn URL import

Not implemented. LinkedIn's self-serve sign-in (OpenID Connect, scopes `openid profile email`) returns only lite profile data (name, photo, email): https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2. Positions and education are not available to a self-serve app, and automated reading of profile pages is prohibited (see `docs/linkedin-2026-10-10.md`). The import panel says so; a stored URL is never presented as an imported profile.

## Evidence

Synthetic fixtures in `apps/api/test/fixtures/linkedin` (regenerate with `node test/fixtures/linkedin/generate.js` from `apps/api`): a two-page career-changer export, a student export with no Summary, and copied profile text. `linkedin-import.pdftest.ts` runs them through the real pdf.js extraction (CI `test:cv-pdf`). The layout is modelled on the export's structure; font sizes are compared relatively, never matched to fixed values. These are not real candidate files, so a real export with a different layout can still need a fix; uncertain fields are flagged for the candidate rather than guessed.

## Migration

`20261030090000_entry_date_precision` is additive: two nullable text columns on `Experience` and `Education`, and `Education.startDate` drops NOT NULL. Previous images ignore the new columns; rolling back the image is safe. Rolling back the schema is not needed.
