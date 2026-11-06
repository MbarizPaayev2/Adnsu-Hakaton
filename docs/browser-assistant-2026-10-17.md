# Browser assistant: gating, pairing, versions and form help (17 October 2026)

Builds on the capability matrix of 16 October (`docs/browser-assistant-capabilities-2026-10-16.md`) and #82 (setup progress, code countdown, extension 0.3.2). Extension version after this change: **0.3.3**.

## What changed

| Area | Before | After |
|---|---|---|
| Premium gating (server) | ZIP, pairing code, consent, work hand-out, identity help and permit checked the plan | Also: `POST /agent/ext/pair` re-checks the plan of the code's owner before the code is used up (plan ended after the code was made → 403 `PLAN_REQUIRED`, code still unused); heartbeat stops with `PLAN_REQUIRED` |
| Extension versions | Server never knew which version a browser ran | Every call sends `X-AISE-Extension-Version`; devices store it. `BROWSER_AGENT_MIN_EXTENSION_VERSION` (off by default) refuses pairing, work, identity help and permits below the floor with `EXTENSION_OUTDATED`. `/agent/capabilities.extension` gives the shipped and minimum versions; `/agent/devices` marks each browser `required` / `available` |
| Pairing | Copy a code from the page into the popup | On the assistant page the extension is detected (bridge content script, assistant page only) and **one click** pairs this browser. The code is still shown as the fallback. A paired browser is never re-paired from a page; the device token never reaches the page |
| Install guidance | Steps for everyone, including a “don't press Pack extension” warning | Steps only when no extension answers in a supported browser; no packing instructions; Edge gets `edge://extensions`; update steps keep the pairing (replace files, press reload) |
| Honest states | Phone notice only | Phone/tablet: what works there (review, approve, pause) and that form help needs a computer. Safari/Firefox/old Chromium: named as unsupported. Each browser shows its version and whether it must or can be updated |
| Identity help (Glorri and other HTTPS forms) | Exact label list | One reusable table: autocomplete tokens, labels (Azerbaijani and English, with “məcburi”/“*” ignored), `aria-labelledby`, control names. Never fills referee, emergency-contact, patronymic (“Ata adı”) or middle-name fields. A phone box with its own `+994` prefix gets only the national number. Still no files, questions, consent ticks or submission |

## Evidence (all local; no real employer, no real Glorri page)

| Check | Result | Kind |
|---|---|---|
| `apps/extension/test/agent.e2e.test.mjs` (Lever flow: describe, questions, approval, permit, CAPTCHA hand-off, closed posting, changed legal text, no confirmation → UNCERTAIN, revoke, unsupported control, sensitive question, portal rejection, device revoked) | 11/11 pass on 0.3.2 (before) and 0.3.3 (after) | real Chromium + unmodified extension, Lever-shaped fixture |
| `entitlement.e2e.test.mjs` | 6/6 (one new: plan ends between code and pairing) | same |
| `bridge.e2e.test.mjs` (new) | 2/2: page sees version, one-click pairs, cannot re-pair, frames ignored, no bridge outside the assistant page | same, AISE-origin test page |
| `apps/api/test/browser-agent.e2e-spec.ts` | 35/35 (one new: version storage and floor) | real Postgres, fixture form descriptions |
| Web vitest (assistant page, bridge, identity table) | all pass | jsdom |
| `assisted-form.spec.ts` › Glorri's real apply steps | 4/4: short and long step 1, letter step with and without an approved letter, referee and experience steps untouched | jsdom on real Glorri markup (saved 17 Oct) |
| `browser-agent.e2e-spec.ts` › assisted letter | approved letter for the vacancy in the tab and its /apply page; none for drafts, other candidates, look-alike slugs or other hosts | real Postgres |

Emulated only: Chrome on Linux (Playwright's Chromium). Not checked: Edge, real Windows/macOS Chrome, Safari, real phones.

## Lever audit

Current adapter behaviour holds in every fixture case above. Live submission to a real Lever employer is still **unverified** (needs a consenting candidate and an approved application). Lever is a small part of the catalogue (Xsolla pilot postings).

## Glorri (968 actionable postings, the largest source)

Glorri's terms forbid automated access without permission (`docs/browser-agent-2026-10-10.md` §1), so there is still **no Glorri submission adapter**. What exists is help the candidate starts in their own tab, step by step.

**Real form structure** (10 Safari saves of `jobs.glorri.az` apply pages by Fizuli, 17 Oct: Unibank, İnnovasiya və Rəqəmsal İnkişaf Agentliyi, Yelo Bank). Redacted copies: `apps/extension/test/fixtures/glorri/`.

- No login was needed to reach the form; the page loads Google reCAPTCHA (invisible), which stays the candidate's.
- Every form is a Mantine stepper. Most have **2–3 steps**: "Şəxsi məlumatlar" → "Motivasiya məktubunuz" → (optional) "Suallar". Yelo Bank's has 7 (adds languages, experience, education, referees and a quiz with a data-privacy tick).
- Step 1 controls: `name.first` (Ad), `name.last` (Soyad), `email` (Email), `phoneNumber` (Mobil nömrə, no visible +994 prefix), CV file (PDF/DOC/DOCX), optional photo. Per employer extras: `name.father` (Ata adı), `address`, `dateOfBirth`, `citizenship`, `militaryStatus`, `salary` + `salaryType` (net/gross) + `salaryCurrency` (preset AZN), `linkedinLink`, `nationalId.finCode`.
- Letter step: one `textarea name="coverLetter"` labelled "Motivasiya məktubu", required at some employers (Yelo) and optional at others (Unibank).
- Referee step uses the same labels as step 1 ("Ad", "Soyad", "Email", "Mobil nömrə") under `recommenders.N.*` names.

**What the extension does on Glorri (0.3.3)**

| Step | Filled when empty | Always left to the candidate |
|---|---|---|
| Şəxsi məlumatlar | Ad, Soyad, Email, Mobil nömrə from the AISE profile | CV, photo, Ata adı, address, birth date, citizenship, military status, salary, FİN, LinkedIn |
| Motivasiya məktubu | The letter the candidate **approved in AISE for this vacancy** (`GET /agent/ext/assisted-letter?url=…`: latest APPROVED snapshot of their own LETTER for their match with the posting; never a draft, never generated on the spot). None → told so, box left empty | Writing a letter when AISE has none |
| Languages, experience, education, referees, questions, privacy tick, "Davam et", final send | nothing | everything |

Fixed on the way: before 0.3.3 the identity help would have put the candidate's own name, e-mail and phone into Glorri's **referee** fields (same labels, `recommenders.*` names). Now excluded and tested against the real markup.

## Real-world gaps

- No real employer has received an application through the assistant.
- Glorri checks are on saved real markup in jsdom (the cloud cannot reach glorri.az) and the letter lookup on real Postgres. Not yet tried by a person in Chrome on a live Glorri form: whether Glorri's phone mask accepts `+994…` as typed, and whether its form state picks up the filled values when "Davam et" is pressed.
- Extensions older than 0.3.3 cannot be detected by the page and report no version; they show “older than 0.3.3”. The floor stays off until production users have updated.
- Unpacked install with Developer mode remains (no Chrome Web Store listing).
