# Release readiness and deployment plan (4 October 2026)

Checkout `aise-integration`, branch tip `8604948a127421c4bce855f90cf160e2fcb0b074` (PR #16 head) when this was written. **Nothing here was deployed, merged, enabled or sent.** No production system was contacted; production facts below are the last recorded ones (dates given) and every plan starts by re-reading them. The founder preview and all unrelated resources were left alone.

## 0. Where we stand

| Scope | Verdict |
|---|---|
| The integrated code (documents, e-mail applications, vacancy automation) | **Code-ready**: CI green on the exact head, 19 + 5 real-browser journeys, 360 e2e, migration and data-layer rollback rehearsals (see `release-handoff-integrated-2026-10-04.md`). |
| Deployment to `tefma` | **Not ready**: the infrastructure gates inherited from PR #12 (§1) are still open, and production is **25 migrations behind**, not 3 (§1 note). |
| Real document generation (live model) | **Not evidenced**: no key or spending authorisation on this machine; the bounded pilot is ready to run in one command once supplied (§3). |
| Live e-mail applications | **Off and unrehearsed against the real provider**; stays off at deploy (§4). |
| Scheduled source collection | **Off**; first canary named (§6), gated on a terms review. |
| Payments | **Off**; the sandbox lifecycle was never run and the host's Dodo key is a live key (§1). |

Actual blockers needing you are in §7.

## 0a. Free-MVP blocker classification (5 Oct, MVP-completion mode)

Free MVP = sign-up and mail verification, CV upload and onboarding, real matching, catalogue, native employer vacancies and applications, admin. Features frozen; nothing new added except the one switch below.

| Item | Class |
|---|---|
| Integrated code, migrations (21 → 46 rehearsed), journeys, e2e, CI on the exact head | **verified** |
| Document generation with a real model | **kept disabled, visibly**: new `DOCUMENT_GENERATION_ENABLED=false` (set by `host-config.sh documents-off`) makes quote and generate refuse with an "unavailable" message, nothing reserved; existing documents stay usable; unset = on. Turn on after the §3 pilot |
| E-mail applications, scheduled sources, payments, live external apply, Mode B | **remain disabled** (defaults; verified off by `verify-deployment.sh`/smoke) |
| Production never uses fake model or scorer output | **verified by construction**: fakes exist only in tests/preview; production reads `NVIDIA_API_KEY`/`NIM_*` and the real matching service |
| Durable off-host backup destination; alert destination | **missing external input** (founder) |
| Merge of PRs #12→#13→#15→#16 to `main` (founder merges) | **missing authorisation** |
| Images from the merged SHA; backup + restore proof; migrations; smoke | **executable only inside the window** (§5), after the three rows above |
| Rollback rehearsal with exact images | **missing decision**: run on the Mac, or accept the data-layer evidence (§1) |
| Secret files, MFA key, DB password, host capacity | **executable by the operator in the window** (`host-config.sh`; rotation stays a separate step) |

## 1. Reconciling the handoff with the earlier release gates

Sources: `release-2026-09-30.md` (§10 change plan and its 1 October corrections), `cloud-handoff-2026-10-01.md`, `host-hardening-and-backups.md`, `release-2026-10-05.md` (§2.6–2.9, §4), `next-session-handoff-2026-10-03.md`, `retention-and-product-handoff-2026-10-03.md`, the integrated handoff. **Nothing below is marked closed unless there is evidence newer than the gate; production state is as recorded on 29–30 Sep and has not been re-read since.**

| Gate | Last evidence | Status now | What closes it | Owner |
|---|---|---|---|---|
| CI green on the exact head to deploy | PR #16 `8604948`: both runs pass | Re-needed on the **merged `main` head** (§2) | CI on that SHA | automatic |
| **Durable off-host backup destination** (company-owned bucket, write-only key, `offhost-sync.sh --selftest`) | none; the Mac holds the only copies (newest off-host set `20260930T053747Z`, 4 days old; no launchd agent, no `rclone`) | **OPEN, a blocker** | founder picks the account (R2 or B2, ~$0 at this size, nothing bought without approval); then `rclone` on `tefma`, `AISE_OFFHOST_REMOTE=… scripts/offhost-sync.sh --selftest` | founder |
| Backup + restore proof of the set taken **immediately before** the window | 29 Sep (`3867b07`, 4 s restore) and 30 Sep sets; stale for a 25-migration change | open (done in the window) | `backup.sh` with the release's scripts → `mac-verify-backup.sh` → `RESTORE TEST PASSED` + `check-backup-evidence.py` | operator + Mac |
| Backup schedule (cron) and `/admin/system` status | no crontab on 30 Sep; status dir was an empty root-owned directory | open (verify) | `host-config.sh backup-status`, cron lines from `release-2026-10-05.md` §4.5 **after** the bucket works | operator |
| **Alert destination** that a person has actually received a test alert from (Uptime Kuma push monitor + a channel they read, and/or `ALERT_EMAIL_TO`) | none | **OPEN, a blocker**; also new: a source cooldown has **no outbound alert** (admin page and log only) | create the Kuma Push monitor and channel; deliberate test alert received | founder |
| **MFA**: `ADMIN_MFA_ENCRYPTION_KEY` | unset on the host on 30 Sep (admins cannot enrol MFA) | **OPEN** (verify) | `scripts/host-config.sh mfa-key`; **founder copies the value to the password manager at once**; founder enrols MFA and saves the 10 recovery codes | founder + operator |
| Secret files `root:root 0644` | 30 Sep | **OPEN** (verify) | `host-config.sh secure-files`, `web-env` (no sudo) ; `docker compose config -q` prints ok | operator |
| **Database credentials**: default `POSTGRES_PASSWORD` | 30 Sep: still default (reachable only on the host after the port fix) | **OPEN, deliberately a separate step** | `scripts/rotate-db-password.sh` dry run then `--apply`, only with a proven backup set; **not in the deploy window** | operator |
| **Exact images** from the merged commit | only an earlier head was built (cache-only on the host, 29 Sep); matching image not rebuilt in production | **OPEN** | `scripts/build-image.sh {matching-service,api,web} <sha>`; `check-image-provenance.sh` for each; `apply-worker` is **unchanged** since `main` (no rebuild) | operator |
| **Migrations** | rehearsed: 21 → 46 on a synthetic legacy database (data backfills confirmed: Remote 5, levels 8 of 40), 43 → 46 and 32 → 46 on copies; no drift; every pre-existing table identical | evidence in place; **production is at 21, so 25 migrations apply at API start** (2 from PR #12, 23 from PR #16) | applied by the API container on start inside the window | window |
| **Rollback rehearsal with the exact images** (`rehearse-rollback-compat.sh`, docker runtime) | native-runtime pass (36 checks) on 1 Oct for the PR #12 code; the integrated tree has the **data-layer** boundary proven with `main`'s own Prisma client (production's current schema) and the previous release's client | **OPEN for the images**; the shared host cannot carry the rehearsal (≈3 GiB of containers, 2.2 GiB available) | run it on the Mac with the exact images (emulated amd64, slow) **or** the founder accepts the data-layer evidence plus the one-way boundary in §5.5 | founder decision |
| Payments | 29 Sep: live Dodo key on the host, checkout off only because the code needs `PAYMENTS_ENABLED=true`; sandbox lifecycle **NOT RUN**; Premium/Plus provider products (`DODO_PRODUCT_ID_PLUS/PREMIUM`) not created | stays **OFF**; not part of this release | `host-config.sh payments-off` writes `PAYMENTS_ENABLED=false` explicitly | founder (later) |
| Real mail for verification/reset | PASS on the host 29 Sep (current image) | re-check after deploy (§5.6) | isolated throwaway stack with the **deployed** image, as on 29 Sep | operator |
| E-mail applications against the real provider | never run (sink only) | **OFF**, unrehearsed | §4 | founder + operator |
| Real-model document generation | live check of the **old** tailoring on 30 Sep (host, synthetic, model `nvidia/nemotron-3-super-120b-a12b`); the new CV/resume/letter pipeline has never met a real model | **OPEN** | §3 | founder (authorisation) |
| Real scorer, API level (`jobs-matching-real-scorer`) | passed on the PR #12 head (1 Oct); **not run** on the integrated tree (no local scorer service); CI runs the scorer's own self-tests and evaluation, not this e2e | open, low risk | run with `AISE_REAL_SCORER_URL` against a CPU scorer built from the release image | operator |
| Source terms reviews | all sources `ROBOTS_ALLOWED_TERMS_PENDING` | **OPEN** | recorded review per source before any schedule | founder |
| Glorri permission | not obtained; founder keeps the existing hourly importer running; live auto-apply stays off | unchanged | `docs/glorri-partner-request.md` | founder |
| Telegram bot, alert e-mail provider verification (`NOTIFICATION_LINK_SECRET`, `API_PUBLIC_URL`), Premium prices and the tailoring-behind-Premium decision | listed open on 3 Oct | **OPEN** (features off/untested live) | founder inputs | founder |
| Human reviews: PDF typography in 4 languages, other browsers/devices, screen readers, native review of the Azerbaijani letter style | not done | open | reviewers | founder |
| Matching service image (CPU image, pinned model, in-image self-test) | built cache-only on the host 29 Sep; not deployed | open (part of the window) | build + `docker compose exec matching-service python selftest.py` | operator |
| Host capacity (7.1 GiB RAM, swap heavily used, ≈17 GB free disk; shared with other services) | 29 Sep | **re-check**; builds need the capped builder and a quiet host | `build-image.sh` guards abort under pressure | operator |
| `TODO(legal)` placeholders on public pages | `deploy.yml` comment says they exist | none found in this tree (searched); the comment is stale | founder confirms the legal pages | founder |

**Two corrections to earlier statements.** (1) The handoff and the integration plan speak of "three migrations": that is what the growth branch added. Production (21) gets **25**, and `20261005090000_source_registry_and_job_facts` is a *data* backfill (it sets work arrangement and experience level from Glorri payload fields); the others that change data only register or hold sources. (2) `TAILOR_DAILY_LIMIT`: `main` caps tailored CVs at **10 per user per 24 h by default**; the new code has no default cap (Free: 5 documents a month; paid plans are off). To keep today's provider-spend ceiling unchanged at deploy, set `TAILOR_DAILY_LIMIT=10` in `apps/api/.env`.

## 2. Deployment ancestry and the review/merge sequence

Measured from the remote on 4 Oct (`origin/main` = `14f3e94`, PR #11's merge):

```
main 14f3e94
 └─ #12 claude/matching-eval (non-draft, ready)         +18 commits   migrations 21→23
     ├─ #13 codex/azerbaijan-job-sources (draft)         +2            (23)
     │   └─ #15 codex/employer-source-coverage (draft)   +1            (23)   [base of #16]
     │       └─ #16 codex/vacancy-email-applications     +110 (11 merges)    23→46
     └─ #14 codex/public-vacancy-catalogue (draft)       +1  (side branch: contained in #16 through a merge commit, not in #15)
```
* `main` is an ancestor of every branch (0 behind). Every PR head in the stack, and every UX/document/growth branch, is an ancestor of `8604948`. There are **no duplicate commits** (patch-id check over the 131 commits above `main`: 0 groups).
* PR #16 targets `codex/employer-source-coverage`, so its page shows only the 110 commits above that base. All five PRs have green CI and are mergeable.
* **Merge method matters.** Use *Create a merge commit* for each. A squash or rebase rewrites SHAs, which would make each child branch re-apply commits its base already contains (duplicate commits and conflicts).
* **Recommended sequence (bottom-up; nothing merged yet):**
  1. #12 → `main`. Wait for CI on the new `main` head.
  2. #13 (retarget to `main` if GitHub did not do it: `gh pr edit 13 --base main`), CI.
  3. #15 (`gh pr edit 15 --base main`), CI.
  4. #14 may go any time after #12 (one commit); or leave it: it is already inside #16 and will show as merged when #16 lands.
  5. #16 (`gh pr edit 16 --base main`; ready for review), CI.
  Each step's PR then shows only its own commits. Review order = merge order; #12 is where the infrastructure gates live (matching, backups, rotation, verifier), #16 is where the product is.
* **Alternative:** retarget #16 to `main` and merge it alone: #12–#15 then show as merged (their heads are ancestors). One merge, one CI run, but the infrastructure review in #12 and the 131-commit product review collapse into one decision.
* **Merging does not deploy.** `deploy.yml` is manual (`workflow_dispatch`) and the `push` trigger is commented out; the migrations run when the API container starts on the host.
* **Before each merge:** `git fetch origin && git merge-base --is-ancestor origin/main origin/<head>` (if `main` moved, re-run `git merge-tree --write-tree --name-only` against it). The deployment SHA is the final `main` head after step 5.
* **Outside the stack, not a prerequisite:** `origin/fix/docker-internal-api-url` (one commit, 1 Oct, from an external contributor: server-side API calls inside a local Docker web container use `INTERNAL_API_URL`). It conflicts with the integrated tree in `apps/web/src/app/api/auth/[...nextauth]/route.ts`, and production does not need it (the web build inlines the public API URL and Caddy serves it). `origin/codex/e2e-workflow` is 78 commits behind `main` (22 Sep) and superseded by the existing smoke script. Decide separately; do not fold either into the release.

Commands for the sequence (not run):
```bash
gh pr ready 16                                    # when reviewed
gh pr merge 12 --merge && gh pr checks 12 --watch   # then confirm CI on main's new head
gh pr edit 13 --base main && gh pr merge 13 --merge
gh pr edit 15 --base main && gh pr merge 15 --merge
gh pr edit 16 --base main && gh pr merge 16 --merge
git fetch origin && git rev-parse origin/main       # the 40-character SHA to deploy
```

## 3. Real-provider prerequisites (document generation) and the smallest bounded pilot

**What the product reads** (`resume-tailor.service.ts`): `NVIDIA_API_KEY` (required), `NIM_MODEL` (default `openai/gpt-oss-120b`; production was configured with `nvidia/nemotron-3-super-120b-a12b` on 30 Sep), `NIM_API_URL` (default `https://integrate.api.nvidia.com/v1/chat/completions`); bounds `TAILOR_MAX_CALLS` 3, `TAILOR_TIMEOUT_MS` 60 000, `TAILOR_DEADLINE_MS` 180 000, `TAILOR_MAX_OUTPUT_TOKENS` 4 096; optional `TAILOR_DAILY_LIMIT` (see §1).

**Inspection (names and set/placeholder status only, no value printed):**

| Where | Result |
|---|---|
| This machine's environment | no provider variable set |
| `~/Desktop/aise/apps/api/.env`, `…/.env` | `NVIDIA_API_KEY` **empty**; `RESEND_API_KEY` placeholder; `NIM_*`, `EMAIL_APPLY_*` absent; `MATCHING_SERVICE_TOKEN` present. Also a Dodo payments key and product ids (not touched; payments stay off) |
| Repository checkouts (`aise-integration`, `-deployment`, `-vacancy-growth`) | no `.env` with provider values |
| `~/aise-preview/provider.env` (where the pilot expects them) | **does not exist** |
| Production host | key and model exist there (30 Sep); **not read in this task**. Read-only check for the operator: `grep -E '^(NVIDIA_API_KEY\|NIM_MODEL\|NIM_API_URL\|TAILOR_[A-Z_]+)=' apps/api/.env \| sed -E 's/=.*/=<set>/'` (names only) and `grep '^NIM_MODEL=' apps/api/.env` (the model name is not secret) |

**Missing for a real generation run: a provider key reachable from the machine that runs the pilot, the model name to evaluate (use production's `NIM_MODEL`, not the code default, so the result describes what users would get), and your written spending authorisation (a key alone authorises nothing).**

**The smallest bounded pilot is already built** (`scripts/preview/run-quality-pilot.sh`; dry run executed now, nothing called):
* 6 generations: Azerbaijani CV, Azerbaijani letter, English resume, each with the old prompts and the new ones, synthetic candidates only; real prompt, real fact check, real Typst PDF; no database, queue, e-mail or application.
* **Caps:** `--authorize-requests 18 --authorize-tokens 150000` (the product's 3-attempt bound × 6), stopped by a fetch guard at the cap; cost reported in tokens (and money only if you supply the provider's published prices).
* It refuses without a mode-600 provider file outside git, refuses a loopback or non-https endpoint (a fake is never reported as a model), and logs each authorisation to `~/aise-preview/evals/authorizations.log`.
* Outputs go outside git: results, PDFs, a blank human rubric per document and an independent-reader review sheet for the Azerbaijani letter. Automatic columns only **flag** (unsupported numbers/names, claimed missing skills, language, relevance, page count); the quality verdict needs a native reader.
* **To run (once you provide the file and the caps):**
  ```bash
  # ~/aise-preview/provider.env, mode 600, outside the repository:  NVIDIA_API_KEY=…  NIM_MODEL=<production model>  [EVAL_PRICE_IN_PER_MTOK=… EVAL_PRICE_OUT_PER_MTOK=…]
  scripts/preview/run-quality-pilot.sh --authorize-requests 18 --authorize-tokens 150000
  ```
* The fixture provider results already in the repository (journeys, previews) are **not quality evidence** and are labelled so in the app and the handoff.
* After the pilot, a larger matrix (11 generations incl. Russian and short answers) exists in `test/evals/real-model-documents-eval.ts` and needs its own authorisation.

## 4. Controlled e-mail verification and production smoke checks

**Invariants that must hold in every step** (all verified with the sink; none relaxed here): the candidate approves the exact recipient, subject, body and attachments; approval fixes `payloadSha256` and copies the CV and letter into private storage; a stale preview or a CV re-approved afterwards is refused; the provider is called only from the durable row with a final re-check; anything possibly accepted (timeout, reset, 5xx, unreadable 2xx) becomes **UNCERTAIN** and is never retried automatically; evidence only accumulates (late webhooks cannot move a state back); bounces and complaints suppress the recipient.

**Stage E0: done (local, sink).** Integrated journeys: exact CV and letter bytes at the sink, payload hash recomputed from stored bytes, re-approved CV blocks sending, bounce suppression, pause/cancel, uncertain delivery.

**Stage E1: provider acceptance, isolated, no real recipient** (needs founder inputs): an isolated throwaway stack **on the host** with the deployed API image (the pattern of the 29 Sep mail check: throwaway Postgres and Redis, production key only in a mode-600 temp file, Glorri hosts blocked), `EMAIL_APPLY_ENABLED=true`, `EMAIL_APPLY_TRANSPORT=live`, `EMAIL_APPLY_FROM=<verified sender>`, `EMAIL_APPLY_RECIPIENT_ALLOWLIST=<your controlled inboxes>`, `EMAIL_APPLY_REAL_RECIPIENTS=false`, one synthetic candidate and one synthetic vacancy whose published address is your alias. Run `npm run script:email-pilot-check:prod` first (read-only, prints booleans; today on a bare configuration it reports `readyForControlledPilot: false`, as it should). Record: provider message id, the message in the inbox with both attachments byte-identical to the approved files (compare SHA-256 with the stored `cvSha256`/`letterSha256`), `Reply-To`, the copy to self, and that an address outside the allowlist is **refused before any call**. No webhook is reachable from a throwaway stack, so delivery events are not part of E1.

**Stage E2: webhooks and events, production, after deploy** (needs a decision, §7): register `https://<host>/backend/webhooks/resend` (events sent, delivered, delivery_delayed, bounced, complained, failed) with its signing secret in `EMAIL_APPLY_WEBHOOK_SECRET`; keep the allowlist at your inboxes and `EMAIL_APPLY_REAL_RECIPIENTS=false`, so no real posting's address can ever be contacted. Verify with the provider's documented test recipients (delivered, bounced, complained; confirm the current addresses in the provider's documentation before use). A signed forged event must be rejected and a replayed one ignored. A real **uncertain** outcome cannot be forced reliably against a live provider; it is covered by the local fault tests and unit tests, and E2 may add one deliberate low-timeout attempt (`EMAIL_APPLY_PROVIDER_TIMEOUT_MS` minimum 500) with the recipient being your own alias, reading the result as UNCERTAIN whatever the inbox shows. The catch: a synthetic vacancy with your address would be visible in the public catalogue while it exists, so E2 needs either a short-lived labelled posting that you approve, or waiting for a hidden-test-vacancy mechanism that does not exist yet.

**Never in this release:** `EMAIL_APPLY_REAL_RECIPIENTS=true`, Mode B (`EMAIL_APPLY_AUTOMATION_ENABLED`), inbound replies. At deploy `EMAIL_APPLY_ENABLED` stays unset.

**Production smoke checks (read-only, run on the host after the deploy; none prints a secret):**
```bash
cd /srv/stacks/aise; SHA=<40-char sha>
curl -fsS http://127.0.0.1:4000/health/ready                       # 200, release = first 12 of $SHA
EXPECT_SHA=$SHA EXPECT_IMAGES="api=sha256:…,web=sha256:…,matching-service=sha256:…" scripts/verify-deployment.sh   # exit 0
scripts/check-host-security.sh && scripts/check-health.sh
docker compose exec -T postgres psql -U postgres -d aise -Atc "select count(*), count(*) filter (where finished_at is not null), count(*) filter (where rolled_back_at is not null) from _prisma_migrations"   # 46 | 46 | 0
docker compose exec -T postgres psql -U postgres -d aise -Atc "select key from \"JobSource\" where scheduled"   # only glorri (its own importer); nothing else scheduled
docker compose exec -T api node -e "fetch('http://127.0.0.1:4000/internal/jobs/ingest',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.SCRAPER_SERVICE_TOKEN},body:JSON.stringify({externalId:'work:smoke-no-lease',title:'x',company:'x',description:'x',location:'Bakı',url:'https://example.org/x',postedAt:new Date().toISOString()})}).then(r=>console.log(r.status))"   # 409: the lease gate; nothing stored
docker compose exec -T postgres psql -U postgres -d aise -Atc "select (select count(*) from \"Job\" where status='ACTIVE' and \"hiddenAt\" is null and \"duplicateOfId\" is null and (deadline is null or deadline>=now())) + (select count(*) from \"Vacancy\" v join \"Company\" c on c.id=v.\"companyId\" where v.status='ACTIVE' and c.status='APPROVED' and (v.deadline is null or v.deadline>now()))"   # equals meta.total of the next line
curl -fsS 'http://127.0.0.1:4000/jobs?limit=1' | python3 -c "import json,sys; print(json.load(sys.stdin)['meta']['total'])"
curl -fsS http://127.0.0.1:4000/billing/status                     # paymentsEnabled false
docker compose logs api | grep -E 'EMAIL (CONFIG|ERROR)'          # empty
docker compose exec -T api npm run script:email-pilot-check:prod   # readyForControlledPilot false (the safe default)
```
Browser, by the founder: `/admin/sources` shows each source as Hazırdır, Söndürülüb or Məhdudiyyət var; only Glorri (scheduled, recent hourly runs) may read Sağlam; no source reads Sağlam because of an old success. `/admin/system` shows the backup, the verified off-host copy and the restore test. Sign in, enrol MFA. **Not recommended against production:** `scripts/smoke-e2e.sh` (it writes accounts, approves a company and grants an entitlement directly in the database); use it only with your explicit approval.

## 5. The deployment plan

Builds on the one production change plan (`release-2026-09-30.md` §10 with its 1 October corrections) and the host procedures (`host-hardening-and-backups.md`); it adds what the integrated release changes. Production host `tefma` (Ubuntu, user `tefma`, key-only, checkout `/srv/stacks/aise`, 4 CPUs, 7.1 GiB RAM, ≈17 GB disk, shared with other services; `sudo` needs the operator's password). **Do not start until every §1 row marked OPEN/blocker is closed or you have accepted it in writing.**

### 5.1 Resources
| | Needed |
|---|---|
| Window | one 45–60 minute maintenance window, off-peak, a person at `tefma` with `sudo`, the founder available for the MFA/key custody steps |
| Disk on `tefma` | ≥ 15 GB free before building (`build-image.sh` needs ≈4 GB per image; the CPU matching image is 0.86 GB); old images kept as `:pre-*` for a day, removed afterwards |
| Memory | builds only through `build-image.sh` (BuildKit capped at 1.75 GiB / 2 CPUs, aborts on pressure); one image at a time; pause heavy neighbours by agreement. The image-mode rollback rehearsal (≈3 GiB of containers) does **not** fit on `tefma` |
| Network | `tefma` must reach Hugging Face at matching build time (pinned revision, plain HTTPS, bounded retries) |
| Mac | Docker Desktop, the age private key (`~/.config/aise-backup/age.key`, present, mode 600), `mac-verify-backup.sh` |
| Time to build | api ≈4 min, web ≈2.5 min, matching ≈8 min on the host (29 Sep measurements); Apple-silicon emulated builds are hours (matching: pip install alone was ≈4 h with the old lock) |

### 5.2 Before the window (no downtime)
```bash
# 0. Merge sequence done (§2); SHA=<40-char head of main>, CI green on it.
# 1. Read-only audit as tefma (nothing changes); record the answers
ssh tefma@100.89.219.95
cd /srv/stacks/aise && git rev-parse HEAD && git status --short && df -h / && docker system df && docker compose ps
free -m; ss -tlnp | grep -E ':(3000|4000|5433|6379|8000|8100)\b'; ls -l ~/aise-backups | tail -4; crontab -l
grep -E '^(NVIDIA_API_KEY|NIM_MODEL|RESEND_API_KEY|PAYMENTS_ENABLED|ADMIN_MFA_ENCRYPTION_KEY|TAILOR_DAILY_LIMIT|EMAIL_APPLY_ENABLED|SOURCE_SCHEDULE_ENABLED)=' apps/api/.env | sed -E 's/=.*/=<set>/'
docker compose exec -T postgres psql -U postgres -d aise -Atc "select count(*) from _prisma_migrations"   # expect 21
# 2. Build the exact images from a clean worktree of $SHA (one at a time, capped)
git fetch origin && git worktree add /tmp/aise-rel $SHA && cd /tmp/aise-rel
cp /srv/stacks/aise/apps/web/.env.local apps/web/.env.local     # NEXT_PUBLIC_* only (host-config.sh web-env first)
scripts/build-image.sh matching-service $SHA && scripts/build-image.sh api $SHA && scripts/build-image.sh web $SHA
scripts/check-image-provenance.sh aise-api:$SHA $SHA /repo/apps/api/dist/scripts/backfill-dedup-keys.js /repo/apps/api/dist/scripts/rescore-profiles.js /repo/apps/api/dist/scripts/repair-glorri-locations.js
scripts/check-image-provenance.sh aise-matching-service:$SHA $SHA && scripts/check-image-provenance.sh aise-web:$SHA $SHA
docker run --rm -e HF_HUB_OFFLINE=1 aise-matching-service:$SHA python selftest.py        # ALL SELFTESTS PASSED
# 3. Rollback rehearsal with these exact images: on the Mac, or accepted as per §1 (EXPECT_SHA=$SHA scripts/rehearse-rollback-compat.sh <old-api-id> <new-api-id> <new-matching-id>)
# 4. Configuration, from the release's scripts (a worktree of $SHA), in this order, no sudo:
export AISE_DIR=/srv/stacks/aise
scripts/host-config.sh secure-files && scripts/host-config.sh web-env && scripts/host-config.sh payments-off && scripts/host-config.sh documents-off && scripts/host-config.sh app-env && scripts/host-config.sh mfa-key && scripts/host-config.sh backup-status
#    then add, by hand, to apps/api/.env (never to git, never printed):  TAILOR_DAILY_LIMIT=10   (applies once documents are switched on)
#    and confirm UNSET: SOURCE_SCHEDULE_ENABLED, SOURCE_SCHEDULE_TICK_PATTERN, EMAIL_APPLY_ENABLED, EXTERNAL_APPLY_LIVE_ENABLED
scripts/host-config.sh preflight                      # every line PASS, else stop
# FOUNDER, NOW: copy ADMIN_MFA_ENCRYPTION_KEY from apps/api/.env into the password manager and confirm. Losing it disables every enrolled authenticator.
```

### 5.3 Backup gate (start of the window; **GO only on `RESTORE TEST PASSED`**)
```bash
# on tefma, with the RELEASE's backup script:
AISE_BACKUP_AGE_RECIPIENT=age1… scripts/backup-daily.sh      # or backup.sh into ~/aise-backups until the bucket exists
# on the Mac (holds the key); SCHEMA_FILE = the schema of the code that wrote the data (production's current commit)
git show 75754ea:apps/api/prisma/schema.prisma > /tmp/prod-schema.prisma     # confirm the commit from the audit above
AISE_STATUS_SSH=tefma@100.89.219.95 AISE_BACKUP_AGE_IDENTITY=~/.config/aise-backup/age.key SCHEMA_FILE=/tmp/prod-schema.prisma scripts/mac-verify-backup.sh
python3 scripts/check-backup-evidence.py ~/aise-backups/status/status.json ~/aise-backups 120   # on tefma: this set's archives verify, off-host copy VERIFIED, restore PASSED, nothing older than 120 minutes
```
With no durable bucket the off-host copy is `founder-mac-pull`: the gate is satisfied for this window only, `check-health.sh` keeps alerting, and the risk (a sleeping laptop is not a backup destination) is yours to accept in §7.

### 5.4 Deploy (prebuilt mode; production's own `deploy.sh` predates it, so run the release's copy)
```bash
cd /srv/stacks/aise
git show $SHA:scripts/deploy.sh > /tmp/deploy-$SHA.sh
IMG_API=$(docker image inspect --format '{{.Id}}' aise-api:$SHA); IMG_WEB=$(docker image inspect --format '{{.Id}}' aise-web:$SHA); IMG_MS=$(docker image inspect --format '{{.Id}}' aise-matching-service:$SHA)
DEPLOY_DIR=/srv/stacks/aise DEPLOY_MODE=prebuilt PREBUILT_IMAGES="api=$IMG_API web=$IMG_WEB matching-service=$IMG_MS" HEALTH_TIMEOUT=180 bash /tmp/deploy-$SHA.sh $SHA
```
It keeps the running image of each service as `aise-<service>:pre-<previous commit>`, recreates only the named services (`--no-build --no-deps`; postgres, redis and apply-worker keep running), and waits for `/health/ready`. **The API container applies the 25 migrations when it starts** (the point of no return, §5.5). Then, before the importer's next hourly run: `docker compose exec api npm run script:backfill-dedup-keys:prod` (dry run, then `-- --apply`); `script:repair-glorri-locations:prod` (expect 118, then `--apply --undo-file ~/undo-$(date +%F).json`); the silent re-scoring of your own profile first and then all (`script:rescore-profiles:prod`, steps 10–11 of `release-2026-09-30.md`).

### 5.5 Rollback boundaries
| Stage | What can be undone | How |
|---|---|---|
| Before the API starts | everything | the build/adopt steps change tags only; `scripts/rollback-images.sh <prev-tag> api web matching-service` |
| After the API started, **before any new-enum value is written** (a Plus override, a document in a new state, an e-mail application row) | code, safely: production's own client reads and writes the 46-migration database (proven on the synthetic 21 → 46 copy with `main`'s client) | `scripts/rollback-images.sh 75754ea api web matching-service` (it has no schema guard of its own, which is why the boundary is stated here; a later `deploy.sh` of older code needs `ALLOW_SCHEMA_AHEAD=yes`); the migrations stay (additive, unused) |
| After new-enum or new-table rows exist | **roll forward only.** Old code throws on enum values it does not know; it also drops operator roles/MFA, entitlements and listing hiding if it predates them | fix forward; never deploy `main`'s old images over new data |
| Data | last resort, founder's decision | restore the window's backup into a scratch database first; never over a system that has taken applications or payments since; anything written after the deploy is lost |
Known limits of the old code (from the PR #12 rehearsal): it does not know the silent re-scoring marker (matches a silent rollout created in the last 72 h could be e-mailed) and shows duplicate-linked postings again; there is no match-e-mail pause switch, so decide before rolling back after a re-scoring rollout.

### 5.6 After the deploy (record PASS/FAIL with times)
The smoke block in §4, plus: `docker compose exec matching-service python selftest.py` → `ALL SELFTESTS PASSED`; the isolated real-mail check with the **deployed** image (§4.4a step 4 of `release-2026-10-05.md`: verification and reset mail arrive); a post-deploy backup with the now-deployed scripts, pulled to the Mac, restore test with the release schema (46 migrations) → PASS; the founder signs in to `/admin`, enrols MFA, saves the recovery codes; `scripts/check-host-security.sh --probe 100.89.219.95` from the Mac: all closed. After one calm day remove the `:pre-*` images (≈11 GB).
**Defaults after the deploy:** `PAYMENTS_ENABLED=false`, `DOCUMENT_GENERATION_ENABLED=false` (the app answers "unavailable"; existing documents stay editable and downloadable), `SOURCE_SCHEDULE_ENABLED` unset, `EMAIL_APPLY_ENABLED` unset, `EXTERNAL_APPLY_LIVE_ENABLED` unset, `TAILOR_DAILY_LIMIT=10`, every source unscheduled except Glorri's own importer.

## 6. The first scheduled canary (a separate, later decision)

**Xsolla** (`xsolla`, Lever public postings API). Measured from the acquisition database copy and the live trial:
* it is the employer's **own** career feed (the official site links to it), not a job board;
* **one request returns the whole feed** (178 postings, 38 in scope): no pagination, no detail fetches, no discovery cursor, nothing to resume; the run is complete every time, so the verified-complete listing needed for closures exists after the first run;
* proven under the real scheduler: 3 scheduled runs and a crash/restart, 6 requests in total, all HTTP 200, 0 failures, 0 duplicates; robots.txt allows `/` (1 s crawl delay, recorded at registration);
* smallest blast radius of the candidates with a verified complete run (ABB 56 open, PASHA Insurance 35, SOCAR 32 follow; the large boards HelloJob, Work.az, Boss, SmartJob never complete and are excluded).
* One caveat: an earlier run on record failed with "Source response too large" before the response bound was adjusted; if the feed grows past the bound a run fails and the source goes to cooldown (visible in the admin), which is safe.

Gate before it is switched on: **a recorded terms/attribution review for Xsolla/Lever** (every source is `ROBOTS_ALLOWED_TERMS_PENDING`), and an alert destination (§1). Then, as its own change: set `SOURCE_SCHEDULE_ENABLED=true` in `apps/api/.env`, recreate `api`, in `/admin/sources` set `xsolla` scheduled at 1 440 minutes; expect one run within ten minutes (`source_collection_succeeded`, 178 listed, 38 stored, `listingComplete`); watch `source_collection_*` and `source_cooldown_started` for three days. Abort: the `import.scheduled` global pause (no restart), or unset the variable and recreate `api`.

## 7. Blockers that need you, and what was done without you

**Needs your input (in the order they block):**
1. **Off-host backup destination**: which company-owned account (R2 or B2) and approval to enable it; or your written acceptance of the Mac-pull copy for this one window.
2. **Alert destination**: a Kuma Push monitor with a channel you read (and/or `ALERT_EMAIL_TO`), and confirmation that you received a test alert.
3. **Rollback rehearsal with the exact images**: run it on the Mac (hours of emulation), or accept the data-layer evidence plus the one-way boundary in §5.5.
4. **Review and merge** in the order of §2 (the merges are yours; nothing was merged).
5. **A maintenance window** with the operator who has `sudo` at `tefma`, and your presence for the MFA key custody and first MFA enrolment.
6. **Real model**: a provider key in `~/aise-preview/provider.env`, the production model name, and the spending caps (or "no spend yet"). Native readers for the Azerbaijani letter review.
7. **E-mail application live pilot**: the sender address, a Resend key and webhook secret, the controlled inboxes, and your decision on how E2 gets a vacancy that is not public (§4).
8. **Source terms review** for Xsolla (then the canary may be scheduled), and later for the others.
9. Still yours from earlier: Glorri permission, Premium prices and products, Telegram bot, payments sandbox.

**Done independently in this task:** the gate reconciliation with the corrections in §1 (25 migrations, `TAILOR_DAILY_LIMIT`); the ancestry audit with counts, the duplicate-commit check and the merge commands (§2); a **21 → 46 upgrade rehearsal on a synthetic legacy database that matches production's schema** with data backfills confirmed and `main`'s own Prisma client reading and writing the upgraded database (`scripts/rehearse-migration-upgrade.sh`, now with column-aware comparison, an upgrade-notes hook and a rollback client check; logs in `~/aise-preview/integration-evidence/`); the safe provider configuration inspection and the pilot dry run; the e-mail and smoke check design with the read-only command set; the deployment plan with exact commands and boundaries; the canary choice with its evidence. No spend, no send, no schedule, no production contact.
