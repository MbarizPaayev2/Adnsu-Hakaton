# Local founder preview of the integrated product, and the prepared real-model evaluation (4 October 2026)

Branch `codex/vacancy-email-applications`. Nothing here is deployed, merged, or sent anywhere. **Preview readiness, live-provider readiness and release readiness are three different things; this document only claims the first.**

## 1. The preview (synthetic, local, persistent)

| | |
|---|---|
| App | http://127.0.0.1:3470 (real Next.js app, dev mode, served from a git-excluded copy `apps/web-preview`) |
| API | http://127.0.0.1:4440 (real NestJS modules) |
| Control page | http://127.0.0.1:4450 — read-only: e-mails the app captured (so new sign-ups' verification links can be followed) and what the capture sink received, with attachment downloads |
| Database | `aise_preview_20261004` (its own, persistent, migrated with the current migrations). The founder's `aise_local_preview_20261003` and every other database are untouched (verified: still 38 migrations, not migrated, not reset) |
| Queue | Redis, private BullMQ prefix `aise-preview` (kept across restarts) |
| Storage | `~/aise-preview/uploads` (preview-only; the API resolves its upload directory from its working directory) |
| Runtime files | `~/aise-preview/` (mode 700): `credentials.json`, `secrets.json`, `state.json`, `logs/`, `uploads/`, `screenshots/`. **Outside git**; logs contain no secret values (checked) |
| Ports | 3470 / 4440 / 4450 / 4631 (sink). Not the founder's 3450 / 4010 / 4598, so the old preview can still be started later |

### What is real, what is a stand-in
* **Real:** the web app, the API, Postgres, Redis/BullMQ, the document worker, Typst PDFs, the e-mail application pipeline, storage, authentication.
* **Stand-ins, labelled in the app (an amber notice on every page) and on the control page:**
  * document generation = a deterministic loopback **fake that restates the facts it is given. It is not a language model**, and it ignores the requested language, so a Russian or English document from it is not evidence of multilingual quality;
  * matching scores = a keyword-overlap **fixture scorer**, not the production scorer;
  * application e-mail = a loopback **capture sink**: nothing is delivered anywhere; app e-mails are captured, not sent.
* **Disabled:** payments (`PAYMENTS_ENABLED=false`; Plus/Premium cannot be bought), Telegram (no token), external browser applications, scheduled imports (the Glorri cron is not loaded; vacancies come from the seed), live e-mail. Non-loopback `fetch` from the API is refused. (The daily digest job is registered as in any API process; its e-mail would only be captured.)
* The only in-app change for the preview is `components/preview-banner.tsx`: it renders only on a local host, never in a production build, and only when the launcher sets `NEXT_PUBLIC_PREVIEW_BANNER`.

### Synthetic accounts (password in `~/aise-preview/credentials.json`; all `@example.com`)
| Role | Sign-in | Contents |
|---|---|---|
| Candidate, Free plan | `leyla.preview@example.com` at `/login` | Onboarded from a synthetic DOCX; confirmed career evidence incl. a STORY; matches (Free shows 3); **approved Azerbaijani CV and approved English letter** for the Backend vacancy; a **draft Russian concise resume** awaiting review; an **e-mail application prepared with the approved CV + letter and not approved** (approve it and watch the capture sink). Allowance 3 of 5 used |
| Candidate, Plus (operator override, no payment) | `resad.preview@example.com` | Onboarded, all matches, 30-document allowance, no documents yet |
| Candidate, new | `yeni.preview@example.com` | Verified, **not onboarded**: opens the CV upload wizard |
| Employer | `employer.preview@example.com` at `/business/login` | Registered and verified account |
| Admin (SUPER_ADMIN, no MFA enrolled) | `admin.preview@example.com` at `/admin` | Overview, operations, recommendations. Actions that require an MFA session are refused until MFA is enrolled |

Ten synthetic vacancies come from a clearly synthetic source `Preview (sintetik nümunə)` (two state an application e-mail, one is a weak match, etc.), imported through the real guarded import route. Seed is re-runnable any time: users are looked up by e-mail, vacancies upsert on a stable id, every generation has a fixed `requestId` (replayed, never charged twice). It also refreshes the vacancies' "last seen" time, which the e-mail application uses (a listing not seen for 30 days is refused), so re-run the seed if the preview has been idle for weeks.

### Start / stop / inspect (from the repository root)
```bash
scripts/preview/preview.sh start        # starts API, stand-ins, control page and web; waits until ready
scripts/preview/preview.sh seed         # idempotent synthetic data
scripts/preview/preview.sh status
scripts/preview/preview.sh stop         # graceful; KEEPS the database, uploads and queue namespace
scripts/preview/preview.sh credentials  # prints credentials.json
```
Smoke check (read-only, no changes): from `apps/api`, `npx ts-node -r tsconfig-paths/register --transpile-only test/support/preview-smoke.ts`. Screenshots for inspection: `test/support/preview-shots.ts` writes to `~/aise-preview/screenshots/`.
A reset is deliberately not scripted. To start over, stop the preview and drop `aise_preview_20261004` by hand; never touch the other databases.

### Disk
The start refuses below 3.5 GiB free; while running, a warning is logged below 4 GiB (it never stops silently — a silent disk-triggered stop is the most likely cause of the earlier preview disappearing, unproven). The dev server's cache lives in `apps/web-preview/.next` (≈0.2 GiB after a smoke run). Nothing else is cleaned up automatically.

### Preview smoke result (this session)
Startup (web, API readiness `database ok / redis ok`, control page); candidate, employer and admin sign-in through the real forms; the synthetic notice present; the three seeded documents listed; the approved CV downloaded as a real PDF containing the reviewed content; the draft opens with review notes, the free PDF preview and the manual approve button (not pressed); stop → start → reseed left users/documents/vacancies unchanged (3 / 3 / 10). This is a smoke check, not a regression run; the full 19-check journey evidence stays in `documents-integration-verification-2026-10-04.md`.

## 2. Next quality check — PREPARED, NOT RUN, NOT CLAIMED
_Updated the same day: the matrix is now 11 generations (adds two Azerbaijani short answers, budget 33) and includes the Azerbaijani letter style plus an independent-reader review sheet; see `azerbaijani-letter-style-2026-10-04.md`._

`apps/api/test/evals/real-model-documents-eval.ts` (+ `real-model-fixtures.ts`, `real-model-checks.ts`).

* **Scope (bounded):** 3 invented candidates (Azerbaijani, English, Russian) × (concise resume, fuller CV, motivation letter) = 9 generations (plus two Azerbaijani short answers, 11 in all) through the product's own `ResumeTailorService` (real prompt, real fact check, real Typst PDF). Each vacancy asks for skills the candidate lacks (Kubernetes/Go, Spark/Scala, Salesforce/SQL) so a claimed skill is caught.
* **Budget:** `EVAL_MAX_CALLS` (default 33 = 11 × the product's 3-attempt bound); a fetch guard aborts at the budget. No database, queue, e-mail or application is touched.
* **Measures:** latency, provider calls/outcomes, prompt/completion tokens, cost (only if the provider's published prices are supplied as `EVAL_PRICE_IN_PER_MTOK` / `EVAL_PRICE_OUT_PER_MTOK`; otherwise tokens only — no price is invented), fact-check removals, flagged unsupported numbers/names, claimed missing skills, language check, relevance coverage, PDF page count/text. The automatic columns only **flag** for a human; a blank rubric (factual, relevance, language/tone, typography, 1–5) is written next to every PDF for the human reviewer. Results, PDFs and the report go to `~/aise-preview/evals/<timestamp>/` (outside git).
* **Guards against self-deception:** it refuses to run without `NVIDIA_API_KEY`, refuses a loopback or non-https `NIM_API_URL` (a loopback endpoint is a fake), and requires `EVAL_CONFIRM=I-AUTHORIZE-REAL-PROVIDER-CALLS`. `--self-test` (offline, no provider) checks the checks (an invented employer/number and a claimed missing skill are flagged; honest text is not).
* **Status found here:** the provider configuration is **not available in this environment** — no `NVIDIA_API_KEY` in the process environment or in any `.env` file in the repository (only `.env.example`); `NIM_API_URL` and `NIM_MODEL` unset (product defaults would apply). Dry run output: "BLOCKED — missing prerequisites". Nothing was substituted: the deterministic fake was **not** used for this and no model-quality result exists.
* **To run it** (operator with authorised access, from `apps/api`): export `NVIDIA_API_KEY` (and optionally `NIM_MODEL`, prices), then `EVAL_CONFIRM=I-AUTHORIZE-REAL-PROVIDER-CALLS npx ts-node -r tsconfig-paths/register --transpile-only test/evals/real-model-documents-eval.ts --run`, and read every PDF and have an independent native reader complete `az-review-sheet.md` before saying anything about quality.
* Known limit of the harness itself: the PDF inspection and the report path have only been exercised offline (the checks by `--self-test`, the page-count method on the preview's PDFs); the first real run may need small fixes.

## 3. Readiness, kept apart
* **Preview readiness — yes.** The founder can inspect the integrated product locally with the accounts above (stand-ins as listed).
* **Live-provider readiness — no.** Real-model quality, language, cost and latency are unmeasured; the evaluation is prepared and blocked on missing provider configuration.
* **Release readiness — no.** Still blocked or unverified (see `documents-integration-verification-2026-10-04.md`): the real scorer suite, the real worker suite, live e-mail delivery/DKIM, payments, production data, other browsers/devices, screen readers, human review of PDF typography in all four languages.
