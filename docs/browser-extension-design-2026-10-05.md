# Browser extension — design only (5 October 2026)

Status: **design, nothing built, nothing distributed.** Purpose: let a candidate who is signed in to AISE fill an external application form in their own browser from their approved AISE data, then review and submit it themselves.

## 1. Principles
1. **Default is fill + review.** The extension never presses the final submit control. A later opt-in could exist; it is not designed here.
2. **The candidate's browser, the candidate's session.** No scraping, no server-side logins to third-party sites, no stored third-party passwords.
3. **Stop, don't guess.** CAPTCHA, OTP/2FA, login walls, an unknown required question, a file input it cannot satisfy, or a page that does not match the adapter's fingerprint stop the run and hand control to the candidate with the reason.
4. **Minimal permissions.** Manifest V3; `activeTab` + `scripting` injected on user click; host permissions only for the adapters' exact origins, requested as *optional* permissions per site when the candidate first uses it; `storage` for a session token; no `<all_urls>`, no `webRequest`, no `cookies`, no `history`.
5. **Nothing the candidate did not approve.** Only the approved CV/letter snapshots and the confirmed profile are used; answers to free-text questions are drafts in AISE that the candidate approved beforehand (existing document pipeline).

## 2. Architecture
* **Service worker** (background): holds the short-lived token, talks to the AISE API, owns the run state machine, injects the content script on demand.
* **Content script** (per origin, injected only after the candidate clicks "AISE ilə doldur"): runs the site **adapter**; reads the form structure, fills fields, reports a structured result. It never talks to the network on its own.
* **Side panel / popup**: shows the plan (fields to fill, files to attach), progress, blockers, and the "Review and submit yourself" prompt; the only UI that can start or cancel a run.
* **AISE web app**: shows "Open and fill with the extension" next to an application that has an external destination; the extension is optional, the manual path (open the employer page, copy documents) stays.

## 3. Security model
* **Pairing.** Candidate clicks "Connect extension" in AISE (logged in): the API issues a one-time pairing code (60 s, single use). The extension exchanges it for an **extension token**: 15-minute lifetime, audience `extension`, bound to user and device id, scopes `applications:read-plan`, `applications:report`; refresh by re-pairing silently only while the web session is valid, revocable from AISE settings. It cannot read profile data wholesale, change anything outside an application run, or send e-mail.
* **Run authorisation.** `POST /extension/runs` for one application id; the server freezes the plan (field values, document hashes) and returns a run id. Values are served only for that run.
* **Data minimisation.** Plan contains only the fields the adapter declared it needs. Files are downloaded as the approved snapshot (hash checked against the snapshot hash before attaching). Nothing is cached after the run ends; run record keeps field names and outcomes, not values.
* **Page content is data.** Text on third-party pages is never executed or interpreted as instructions; the extension does not send page text to a model. Unknown questions are reported to the candidate verbatim in the panel, not auto-answered.
* **Origin checks.** The content script verifies `location.origin` and a DOM fingerprint against the adapter before filling. The service worker accepts messages only from its own content scripts (`sender.id`, `sender.url`). AISE API calls only to the configured AISE origin.
* **No remote code.** All adapter code ships in the package (MV3 forbids remote code; adapter updates go through store review).
* **Kill switches.** Server-side: global flag, per-adapter flag (checked at run start and returned in every plan), per-user revoke. Client: the adapter refuses if the server marks it disabled.
* **Abuse limits.** One run per application, rate-limited per user and device; audit log entry per run (who, when, adapter, outcome).

## 4. Backend API contract (new module, all behind a feature flag, off by default)
| Method | Path | Purpose |
|---|---|---|
| POST | `/extension/pairing` (web session) | create a one-time pairing code |
| POST | `/extension/token` | exchange code → extension token; `DELETE` revokes |
| GET | `/extension/adapters` | enabled adapters with version, origins, flag state |
| POST | `/extension/runs` `{applicationId, adapterId, adapterVersion}` | freeze plan; returns `{runId, fields:[{key, label, value, required}], files:[{key, snapshotId, sha256, url(short-lived)}], questions:[{key, text, approvedAnswer|null}]}` |
| POST | `/extension/runs/:id/events` | append `{state, field?, outcome, reasonCode}`; idempotent by event id |
| POST | `/extension/runs/:id/confirm` | candidate says "I submitted" → application becomes `SUBMITTED_BY_CANDIDATE` (self-reported, distinct from verified delivery) |
Application states reuse the existing distinct delivery/recruitment vocabulary: the extension can only reach *prepared* and *self-reported submitted*; it can never claim *delivered* or *accepted*.

## 5. Run state machine
`PLANNED → PAGE_MATCHED → FILLING → FILLED_FOR_REVIEW → CANDIDATE_SUBMITTED | CANCELLED`
Side exits to `BLOCKED(reason)` with reasons `CAPTCHA, OTP, LOGIN_REQUIRED, FINGERPRINT_MISMATCH, UNKNOWN_REQUIRED_QUESTION, FILE_REJECTED, ADAPTER_DISABLED, TOKEN_EXPIRED, NETWORK`. `BLOCKED` is never auto-retried; the candidate decides (resume, do it manually, cancel). `FILLED_FOR_REVIEW` is terminal for the extension; only the candidate's own click on the site's submit changes anything, and the extension offers a "I submitted it" confirmation, it does not infer it.

## 6. Adapter interface (TypeScript)
```ts
interface Adapter {
  id: string; version: string; origins: string[];            // exact origins, requested as optional host permissions
  matches(url: URL): boolean;
  fingerprint(doc: Document): 'ok' | 'mismatch' | 'login' | 'captcha' | 'otp';
  describe(doc: Document): Promise<FormField[]>;               // key, kind, required, label, options
  fill(doc: Document, plan: Plan): Promise<FillReport>;        // sets values via native setters + dispatches input/change; attaches files via DataTransfer
  unknownRequired(doc: Document, plan: Plan): FormField[];     // any required control the plan does not cover → stop
  submitControl(doc: Document): Element | null;                // highlighted for the candidate, never clicked
}
```
Adapters are pure DOM code with recorded-fixture tests; they hold no secrets and no network access.

## 7. First targets, from the real inventory
1. **Glorri-hosted apply pages (`jobs.glorri.com`)**: 1,363 of 1,363 active production postings link there, so any adapter value starts here. Application method is currently `UNKNOWN` in the data; first milestone includes classifying the real apply flow (login-gated? CV upload? questions?) by hand, with the candidate's own account. If the flow is login-gated (likely), the extension works in the candidate's already-logged-in tab.
2. **Boss.az** (399 open in the acquisition data) and 3. **HelloJob** (531): largest next boards, only after the founder's terms review enables the source; for the 91 + 127 postings with an explicit employer e-mail the existing e-mail path (Mode A) is preferred over a form adapter.
Not targeted: sources marked `RESTRICTED` (accessbank, azerconnect, bakcell, pasha-capital, unibank).

## 8. Prototype test strategy (before any store listing)
* **Fixtures:** saved, anonymised copies of each target's apply form (HTML + the variants: validation errors, extra question, CAPTCHA, login wall); adapter unit tests run in jsdom/Playwright against them.
* **Fake ATS server:** local page set that mimics the target's form behaviour (React-style controlled inputs, file inputs, multi-step) to test the real extension build in Chrome for Testing via Playwright (`--load-extension`), including permission prompts and token expiry.
* **API contract tests** against the real API + e2e Postgres (pairing single use, expiry, scope, revoke, plan immutability, idempotent events, state transitions, flag off ⇒ 404).
* **Negative suite:** page text containing instructions, mismatched origin, tampered file hash, stale adapter version, unknown required question → must stop, never fill/submit.
* **Manual:** the founder runs one real application on their own account per adapter before the flag is turned on for anyone.

## 9. Milestones
M0 (this document). M1 API module + pairing/token + state machine, flag off, contract tests. M2 extension skeleton (service worker, panel, token, no adapter) + fake ATS tests. M3 Glorri adapter (after M0's manual flow analysis) + fixtures. M4 internal beta unpacked build with the founder only. M5 store review packaging, privacy policy, permission justification. M6 second adapter (Boss) only if terms are cleared.
