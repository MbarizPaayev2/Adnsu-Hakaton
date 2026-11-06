# CV template: source, adaptations and truthful wording (3 October 2026)

For the frontend/copy worker. This is evidence about what the shipped CV renderer actually does. It is not legal review and says nothing about any outcome for candidates.

## 1. Source
- Source document compared: Harvard FAS career services, "Resumes and Cover Letters — Resume Template I (with bullet points)" (`resume-bullets.pdf`, linked in the task; fetched and read on 3 October 2026). It is a one-page layout template with guidance notes.
- Our template: `apps/api/src/resumes/tailor/resume-harvard.typ`, rendered by the Typst compiler (`resume-tailor.service.ts`, template `harvard`). Its own header comment calls it a "Harvard OCS-style resume". The repository records no further provenance (first commit `3d3a7f4`, 4 September 2026), so whether it was copied from that PDF or written to imitate it cannot be established from history. **What can be said truthfully is that its structure follows Harvard's published template**, as mapped below.

## 2. Honest mapping (guide ↔ implementation)
| Harvard Template I | Our renderer | Status |
|---|---|---|
| Name, then one contact line with bullet separators (address, e-mail, phone) | Centered name, headline, one line "location • phone • e-mail • site" | follows (adds a headline) |
| Education first, then Experience | Education before Experience, tested | follows |
| Institution + city on one line, degree + dates on the next, dates right-aligned | Same two-line row pattern, right-aligned location/dates | follows |
| Organization + city, then position + "Month Year – Month Year" | Same pattern; period is stored as "Sep 2015 - Present" and rendered per CV language: Azerbaijani/Russian/Turkish get a localized short month and an en dash (`localizePeriod`) | **partly**: month is abbreviated, and **English CVs keep a hyphen** instead of an en dash |
| Bullets, most recent role first, begin with an action verb, quantified where possible, phrases not sentences, no personal pronouns | The tailoring prompt forbids first-person pronouns and filler and requires unique highlights; **action-verb openings and phrase form are not enforced**, and quantification is limited to numbers the candidate already stated | **partly** |
| "Leadership & Activities" section | Not present (projects/certifications are folded into one Skills section) | differs |
| "Skills & Interests": technical, language, laboratory, interests | One compact Skills section: skill groups, languages with fluency, certifications; no interests | adapted |
| Plain, single column, readable | One column, Libertinus Serif (ships with Typst, covers az/ru/en/tr), monochrome, A4, 10 pt | follows |
| Headings in normal case | Headings upper-cased per language (İ/I handled for Azerbaijani) | differs |
| Bullet glyph "•" | Typst list marker "--" | differs |
| One page | Not forced: long CVs flow to further pages | differs |

## 3. Verified output (real Typst render; `npm run test:cv-pdf` in `apps/api`, 5 tests)
- Azerbaijani characters survive rendering and text extraction (Ə, İ, ı, ö, ü, ş, ç, ğ in names, headings, bullets).
- Header block first; Education before Experience in extracted order.
- Periods in an Azerbaijani CV contain no English month names or "Present"; en dash used; "hazırda" for present.
- A long CV (9 roles × 5 bullets) renders to two or more pages and **every bullet and the last section appear in the extracted text** (nothing dropped at a page break); a short one is a single page.
- The text extractor reads a single column in a sensible order. This shows the PDFs contain real text, **not** that any particular ATS will parse them; no ATS was tested and no ATS score or guarantee exists.
- Synthetic samples: `docs/evidence/cv-harvard-sample-az-1page.pdf`, `cv-harvard-sample-az-long.pdf` (invented person).

## 4. Facts, not embellishment (what the product enforces)
The tailored CV is a **draft the candidate reviews**: a fact check removes any employer, position, date, school, degree, certification, project, language, skill, tool or **number** the profile does not state (`tailor-facts.ts`: `invented_*`, `unsupported_number`); only highlights, summary emphasis and skill order change; the PDF exists only after the candidate approves. The job text may guide emphasis only.

## 5. Wording you may use
Allowed: "**Harvard CV şablonu əsasında hazırlanmış**" (based on the Harvard CV template), "Harvard CV şablonunun quruluşu", "hər dəyişikliyi siz təsdiq edirsiniz", "yalnız profilinizdəki faktlar".
Not allowed: any Harvard logo or crest; "Harvard təsdiqli/sertifikatlı/rəsmi/tərəfdaş" or "Harvard-approved/certified"; any ATS score, "ATS-uyğun", "ATS-guaranteed"; any interview or hiring promise or guarantee; any improvement percentage or multiplier; "unlimited AI" claims. Ready strings (landing, CV preview, application review, Premium comparison, fine print) are in `PRODUCT_SPEC.positioning` and served by `GET /billing/catalogue` under `positioning`; a test rejects forbidden claims and percentages in them.
Do not say the layout is "ATS-friendly": say "mətn kimi oxunan PDF" only if needed, and only as a plain description of the file.

## 6. What would be needed before saying anything about interviews
Candidate-confirmed and employer-confirmed interview outcomes are recorded separately (e-mail applications: candidate-confirmed status events; native: employer status change; external: candidate report) and counted by `npm run script:application-outcomes` (counts, no rates, no personal data). A public claim would first need: enough applications with tailored vs untailored documents, a stated comparison method and period, and the counts above for that period. Until then the copy describes what the product does, not what it causes.
