# AISE Academy: paid pilot proposal (16 October 2026)

**Status: proposal for founder review. Not an offer that has been sent, not agreed terms, and no institution is a partner.** Initial prospects named by the founder: Holberton School, Code Academy, ABB Tech.

## Value proposition

"Help your students prepare stronger applications and organise their job search, while reducing repetitive career-support work."

AISE does not promise interviews, placements, ATS scores or hiring improvements.

## One-month paid pilot (price hypothesis)

| | Proposed |
|---|---|
| Seats | 30 named students, one cohort that is actively job-seeking |
| Duration | 1 month from activation of the first student |
| Price hypothesis | 400 AZN for the month (13.33 AZN per student; 11.1% below 30 × 15 AZN Premium). Not validated demand. |
| Student access | Premium features for the seat period (documents without a monthly cap and with fair-use protections, 100 email applications, browser assistant, tracker) |
| Institution receives | Weekly aggregate report, one named contact at AISE, onboarding session for students, end-of-pilot review |
| Billing | Single invoice. Route (bank transfer, Dodo invoice) undecided; no live charge is set up. |

The public page `/institutions` shows the price only if `NEXT_PUBLIC_INSTITUTION_PILOT_PRICE` is set. By default it says terms are agreed in the pilot agreement.

## What is built today, and what the pilot does by hand

| Need | Today | During the pilot |
|---|---|---|
| Invitations and activation | Normal registration | AISE sends invitation emails and grants Premium per student with the existing operator plan override (time-limited, auditable). |
| 30 named seats, seat dates | Plan override has a duration in days | Override per named student with the pilot's end date; the list is kept by the AISE team. |
| Staff contact / admin | None for institutions | One institution contact; requests handled by email. No institution login. |
| Aggregate reporting | Admin database queries | Weekly report prepared by AISE: joined, profile completed, documents approved, applications recorded. Counts below 5 are shown as "fewer than 5". |
| Continuity after sponsorship | Accounts are personal | When the override ends the student keeps their account, profile, documents and tracker on the Free plan; nothing is deleted. |
| Adviser review of a student's CV | Not built | Only when the student shares a document themselves; no institutional access to private CVs or applications. |
| Pilot enquiry | Built | `/institutions` form → stored `InstitutionEnquiry` + email to the team. |

Building a cohort dashboard, seat management or institution login is deferred until a buyer has agreed to a pilot and said what they need.

## Proposed 90-day cohort continuation

If the first month meets the agreed criteria: 90 days for the same or a new cohort, priced per active seat, with the weekly report continuing and a mid-point review. Price, seat definition (named vs. activated) and renewal terms are founder decisions after the pilot.

## Short demo flow (15 minutes)

1. Import: upload a LinkedIn PDF; show the preview with unclear fields and their source lines; correct and save.
2. Vacancy: open a matched vacancy; show evidenced and not-yet-evidenced skills; add a skill the student confirms.
3. Documents: generate a CV and letter for that vacancy; review, edit and approve; download the PDF.
4. Apply: email application with the approved documents (to a test address in the demo); the tracker entry.
5. Browser assistant: explain the three routes; show form help on a test page. No real employer submission in a demo.
6. Report: show a sample aggregate report built from synthetic data.

## What we measure (and what we do not claim)

Activation (joined / invited), profile completion, approved usable application packs (CV + letter for one vacancy, approved by the student), applications recorded, adviser time per student (institution's own estimate before and after), support requests and time, student feedback (short survey), willingness to renew. Interview invitations are recorded separately as reported by students and are not attributed to AISE from a 30-student pilot.

## Unit cost for this pilot (to be filled with measured data)

`AI + email + storage + hosting allocation + support + payment/invoice fees + onboarding time`, per licensed seat and per activated student. The AI part comes from `GET /admin/ops/ai-usage` once the usage recording is deployed (see `docs/cost-report-2026-10-16.md`). Support and onboarding time must be logged by hand; on current evidence they are the largest cost.

## Decisions for the founder

1. Approve or change the 400 AZN / 30 students / 1 month hypothesis, and whether the price appears on the public page.
2. Payment route for an institution (invoice and bank transfer vs. card checkout).
3. Who handles student support and the weekly report during the pilot.
4. Success criteria to agree with the institution before starting.
5. Whether advisers should get any individual view (only with explicit, revocable student consent).
