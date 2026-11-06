# Browser application agent (built 10 October 2026)

Status: **built and verified; switched on in assisted mode only after the production gates in §9. Autonomous mode is built but stays OFF for every portal** (§8). The founder's authorization is permission to build the feature; each candidate authorizes their own campaign.

## 1. Which portal, and why (researched on the real sites, 9–10 Oct 2026)

| | Glorri (`jobs.glorri.com`) | Lever (`jobs.lever.co`, e.g. Xsolla) |
|---|---|---|
| Apply form | Public, no login: two steps (CV + name, e-mail, phone, minimum salary + net/gross + currency, photo; then a motivation letter); invisible reCAPTCHA | Public single page per posting: resume, name, e-mail, phone, location, links (LinkedIn often required), employer questions, optional EEO survey, hCaptcha; confirmation page at `/<employer>/<posting>/thanks` |
| Terms | Glorri's Terms of Service §9 forbid "any robot, spider, or other automatic device, process, or means to access Service for any purpose" without permission; AISE has **no** permission (`docs/glorri-partner-request.md`) | Not an aggregator's own marketplace: each employer hosts its own posting; no rule against a candidate using their own browser was found; the employer's own terms are not established (Xsolla's permission was never obtained, only the business decision to list its public postings) |
| Our catalogue | 1,260+ postings | 39 Xsolla postings (the Lever pilot source) |
| Decision | **Not supported.** Automating it would breach terms the candidate would then be exposed to. Glorri stays manual (and the existing assisted flow). | **First portal.** |

Claim made nowhere: "any website". A vacancy whose link is not a Lever posting is simply not supported.

## 2. Architecture (smallest reliable)

The agent runs **in the candidate's own Chrome** (Manifest V3 extension `apps/extension`, plain JavaScript, no build step). AISE keeps consent, plan, evidence and state; the extension keeps the portal session. No portal password, cookie or browser profile is ever sent to AISE.
* **API** (`apps/api/src/browser-agent`): campaigns (the candidate's authority), devices (pairing), applications and an append-only event log; a candidate-facing controller (`/agent/*`) and a device-token controller for the extension (`/agent/ext/*`). Migration `20261020090000_browser_agent` (additive: 6 tables).
* **Extension**: service worker polls `GET /agent/ext/next`, opens the posting's real apply page, the content script (`content/lever.js`) **describes** the form as data, AISE decides what may be filled, the content script fills and **verifies** it, AISE issues a single-use **permit**, only then does the page submit. Evidence = the portal's own confirmation page.
* **Web**: `/dashboard/agent` (browser pairing, supported portals with their limits, campaigns with pause/resume/revoke/emergency stop, applications), `/dashboard/agent/campaigns/new` (scope + plain-language consent), `/dashboard/agent/applications/[id]` (questions, approval, reconciliation, plan, evidence, history). The existing "Müraciətlərim" page and the application timeline gain a `browser` channel. The nav entry appears only where the agent is switched on. The extension ZIP is packed into the API image only (`apps/api/private/agent`, never public) and handed out by `GET /agent/extension` to signed-in accounts whose plan includes the assistant.

## 3. Consent (per candidate, recorded, revocable)
A campaign states: portal(s); permitted employers (never empty) and exclusions; target roles; locations; criteria (minimum AISE match score, work arrangement, experience level, must-include/exclude words); **the approved CV (file hash fixed at consent)** and an optional approved cover note; the confirmed answers (contact, links, work authorization, salary, notice period); categories to always ask; daily limit (≤10); expiry (≤30 days); mode. Creation needs the candidate to see a preview, acknowledge it and send back the preview's hash (`CONSENT_SCOPE_CHANGED` otherwise). A campaign is immutable once consented: changing scope = a new campaign. **A match score alone never queues or submits anything**: it is one of several conditions.
Pause holds work (nothing submitted); revoke / emergency stop / expiry cancel everything queued, being prepared, waiting for input or ready, at once; a submit already in flight cannot be recalled and is recorded truthfully.

## 4. States and evidence
`QUEUED → PREPARING → AWAITING_INPUT / READY → SUBMITTING → SUBMITTED`, plus `FAILED`, `CANCELLED`, `UNCERTAIN`. Every transition is guarded (`updateMany … where state in …`) and logged.
* **The permit** is the only door to a submission: issued for one application to the browser holding its lease after re-checking consent in force, expiry, mode (assisted: the approved plan hash; autonomous: operator-verified portal), the form's legal/AI-use text unchanged, no missing or mismatched fields, vacancy still open, no duplicate on another route, daily and spacing limits (under a per-candidate lock), file unchanged. Single use, 3 minutes.
* **`SUBMITTED` with `confirmation=PORTAL`** only when the extension reports the posting's own `/thanks` URL (checked server-side against this posting). A click, or a look-alike URL, is never "submitted". **`confirmation=CANDIDATE`** (the candidate says they sent it) is stored and shown separately and is never described as portal-confirmed.
* After a click with no confirmation, or a lease that expires mid-submit, the state is **`UNCERTAIN`**: never retried automatically. Lever has no status page to reconcile against, so the candidate reconciles from the confirmation e-mail ("received" or "not received → start over with a fresh plan and approval"). Real confirmation arriving later upgrades `UNCERTAIN` to `SUBMITTED`.
* CAPTCHA, login, unsupported controls, required sensitive disclosures and legal declarations go **to the candidate**; the agent never bypasses them. A challenge shown before submission returns to the candidate in their own open tab; completing it is still captured as evidence.

## 4a. What is filled, and what never is
Deterministic mapping from the page's real control names and labels (no model, so page text cannot instruct it): contact, links, location, current company, work authorization, salary and notice from the **confirmed answers**; the cover note only into a field labelled cover/motivation letter. Optional fields without a confirmed answer stay empty. EEO/demographic fields and consent/agreement checkboxes are never answered on the candidate's behalf (asked when required, never remembered). Unfamiliar required questions are asked; an answer may be remembered for the same employer's same question (never sensitive or legal). Text inside a question (e.g. "ignore the limit…") changes nothing (tested).

## 5. Duplicates and integrity
Unique `(userId, jobId)`; deterministic idempotency key; discovery and the permit both check the e-mail route, the external-apply route and other agent applications for the same vacancy (and linked repeats); the e-mail route in turn refuses a vacancy with a live agent application. Leases prevent two browsers acting on one application. The CV is re-hashed at preparation, download and permit; a changed file fails the application (`RESUME_CHANGED`) and is never sent; the extension verifies the hash again before attaching.

## 6. Verification: what is real and what is a fixture
| Evidence | Level | Result |
|---|---|---|
| `field-resolver.spec.ts`, `agent.e2e` unit/e2e | real Postgres, real HTTP routes, the real Lever **control list** as input | 14 resolver tests; **31 API e2e tests** (consent, pairing, discovery scope, assisted journey, every permit gate, revocation of queued/running work, uncertain outcomes, integrity, isolation, autonomous). Mutation check: removing two permit gates fails the suite |
| `test/agent.e2e.test.mjs` | **real Chromium with the unmodified extension**, real compiled API, real Postgres; the portal is a **fixture** shaped like the real Lever form (same field names, ✱ markers, hCaptcha response, SUBMIT button) served as `https://jobs.lever.co` through host mapping | 11 of 11: describe → question → answer → approval → permit → submit → portal confirmation (fields and CV hash received by the portal verified); resume-parser autofill overwritten by confirmed answers; challenge handed to the candidate and completed by them; closed posting; changed legal text withdraws approval; no confirmation = UNCERTAIN, not retried, candidate reconciles; revoke while waiting; unsupported control; required sensitive disclosure; portal rejection; browser revoked (401 → re-pair) |
| `test/ui.e2e.test.mjs` | real Next.js production build + the above | dashboard journey: pairing code → pair → consent preview/acknowledge/create (keyboard on the critical controls) → form read → candidate answers → approval → portal confirmation → timeline → revoke; every control has an accessible name; no horizontal overflow and no small buttons at 375 px; 12 review screenshots |
| `test/real-lever-readonly.mjs` | **genuine real page, no fixture** | on `jobs.lever.co/xsolla/…/apply`: the content script read 20 controls (required flags, selects with options, a nameless country select, 93 characters of AI-use notice), filled 5 text/select fields and verified them with 0 mismatches, and reported the 3 required fields still empty (resume, relocation, expected compensation). **No file was attached and nothing was submitted**: the run asserts there was no POST to the posting (only Cloudflare/hCaptcha/LinkedIn page telemetry) |
| Live submission to Lever / any employer | **not verified** | There is no safe test destination (no Lever sandbox; real employers). By instruction no real application was sent to test the agent. The workflow is verified up to the submit permit on the real page, and through confirmation on the fixture only |

## 7. Operations
Environment (all default OFF): `BROWSER_AGENT_ENABLED` (assisted), `BROWSER_AGENT_AUTONOMOUS_ENABLED` and `BROWSER_AGENT_AUTONOMOUS_PORTALS=lever` (autonomous, per verified portal), `BROWSER_AGENT_USER_DAILY_LIMIT` (10), `BROWSER_AGENT_GLOBAL_DAILY_LIMIT` (200), `BROWSER_AGENT_MIN_GAP_MS` (60,000), `BROWSER_AGENT_LEASE_MS`, `BROWSER_AGENT_MAX_CAMPAIGN_DAYS` (30). Operator emergency stop: admin pause key `agent.submissions` (permits, claims and heartbeats stop). Disable the feature: `BROWSER_AGENT_ENABLED=false` + recreate the API. Daily counts use the UTC day.

## 8. Autonomous mode: built, not activated
Activating it needs a portal that is verified end to end. Lever's live acceptance has not been observed (see §6), so `BROWSER_AGENT_AUTONOMOUS_PORTALS` stays empty: campaigns can only be created in assisted mode. The code path is tested (31 e2e + browser fixture), and turning it on is one setting once a safe test destination exists or the founder accepts the risk for a named employer.

## 9. Limitations (honest)
* No real submission has been observed on any portal; Lever may challenge automation more often than a human (hCaptcha): then the candidate is asked, repeatedly if needed.
* Works only while the candidate's Chrome with the extension is open; distribution is a zip (Developer-mode install); a Chrome Web Store listing needs the founder's developer account and review.
* Lever location autocomplete, multi-file or unusual controls are not handled (reported as unsupported).
* The employer's/portal's own terms may restrict automated filling; the consent says so and the candidate carries it. Xsolla has not given permission for this.
* One portal; no Glorri; letters are a single approved note, not per-vacancy generated documents (those need per-vacancy review).
