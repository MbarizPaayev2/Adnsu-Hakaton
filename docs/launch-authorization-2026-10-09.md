# Founder authorization and launch record (9 October 2026)

This page records what the founder authorized in chat, what that authorization is **not**, and (appended below as each step finishes) what was done under it. Nothing here contains a credential.

## 1. Authorization (founder, chat, 9 October 2026)
* **Alert e-mail received.** The founder confirmed that the production alert e-mail sent on 9 October arrived (receipt recorded from the founder's own message; the alert path was already proven by the 7 October test mail).
* **Routine work.** The founder authorized the remaining launch work (implementation, deployment, configuration) without a fresh approval per step.
* **Documents.** Deploy the merged OTHER-entry correction and enable CV/résumé and motivation-letter generation. The founder **accepts the documented limitations of the current composition approach** (`docs/document-quality-az-2026-10-09.md` §6) for the initial launch. This is a business acceptance. It is **not** an independent native-reader quality approval and must never be described as one. Candidate review stays mandatory. Roll back the activation if a material factual or operational defect appears.
* **Payments.** Finish the sandbox website-checkout and customer-portal checks; verify Plus 8 AZN/month and Premium 15 AZN/month, webhooks and entitlement changes; enable production payments only after documents and these checks pass. No live charge is made to test activation; the live catalogue and checkout configuration are verified without charging anyone.
* **E-mail applications.** One synthetic application with real-provider attachments, sent only to `ceo@aisehr.com` (this test e-mail is authorized). If it succeeds, enable candidate-approved e-mail applications with the existing Free allowance and higher paid-plan limits. The candidate must approve recipient, documents and final payload every time; **nothing is ever sent automatically on the founder's authorization alone**, and automatic mode (Mode B) stays off.
* **Vacancy automation.** The founder chose **option B** for the Xsolla-only pilot (`docs/xsolla-pilot-activation-2026-10-09.md` §2): proceed on the documented public-feed basis. This is the **founder's business decision, not written permission from Xsolla**. Smallest bounded daily pilot; PAŞA Sığorta stays pending its permission issue; no company permission e-mails are sent; the existing Glorri importer is preserved.
* **Admin access.** The stored admin credentials may be used in an authorized browser session (never printed or shown). The engineer helps with MFA enrolment; the QR scan on the founder's own phone is the only step the engineer cannot do. Recovery material is saved privately (mode 600). The second admin is left unchanged.
* **Finish.** Restore-proven backup before each deploy, CI verified on the exact release commit, rollback commands preserved, each feature reported separately as enabled / verified / blocked.

## 2. Standing limits (unchanged)
No credential in chat or Git; no live charge; no automatic application sending; production never uses a fake model or provider; preserve other stacks, previews, backups, Cloudflare, Zoho and user data.

## 3. Execution log
(appended as each step completes)

### Payments — sandbox verified; production switch pending the fixed release
* **Website checkout and portal, sandbox, through the real UI** (private API + local web app on a private database, Dodo test mode, signed events delivered by the official CLI relay; no card was typed anywhere): the checkout page for Plus and Premium creates a Dodo session and redirects to the hosted page, which shows **"AISE Plus [Sandbox]" AZN 8.00 / Month** and **"AISE Premium [Sandbox]" AZN 15.00 / Month**, tax included, test mode. A sandbox Plus subscription (created by the provider API against a saved test card) arrived through a genuine signed webhook and the settings page showed **PLUS, active, renewal date**; the "manage subscription" button opened the Dodo customer portal. Entitlements: Plus **30 generations/month**, scheduled cancellation keeps Plus with `cancelAtPeriodEnd=true`, cancellation returns the account to **Free, 5 generations/month**. Earlier sandbox evidence (renewal, failed card, recovery, duplicate/tampered/stale webhooks) is in `docs/payment-verification-and-admin-reset-2026-10-07.md`. All sandbox processes were stopped afterwards and the relay webhook disabled.
* **Live catalogue (read-only, nothing charged):** live Plus = AZN 8.00 / month and Premium = AZN 15.00 / month, tax inclusive, 10-year subscription length (the renewal-defect fix), hosted-checkout preview totals 8.00 and 15.00; the live webhook endpoint `https://aisehr.com/backend/webhooks/dodo` is enabled and rejects an unsigned post with 400.
* **Defect found when payments were switched on (and the switch reverted within minutes):** the API still accepted the retired plan ids `basic`/`standard`/`unlimited`, and the checkout page's `?plan=basic` link, for a new live checkout. No checkout was created. Fixed in PR 34 (retired plans return 400 and are listed `purchasable:false`; existing subscribers' events still resolve), unit and e2e tests updated. Production payments stay **off** until that release is deployed, then they are switched on and verified (see the final status below).

### E-mail applications — real-provider test passed; production enablement blocked on the webhook secret
* Isolated throwaway stack on the host (deployed image, production provider key in a mode-600 temp file, allowlist `ceo@aisehr.com`, real recipients off), one synthetic candidate (reply-to and copy = `ceo@aisehr.com`) and one synthetic vacancy whose published address is `ceo@aisehr.com`; documents generated with the real model and approved by the (synthetic) candidate. **24 of 24 checks passed**: eligibility, draft shows recipient and both attachments, nothing sent before approval, a wrong payload hash and a missing consent are refused, the candidate's approval sends exactly **one** message (a second approval does not send again), the provider accepted it (**`PROVIDER_ACCEPTED`**, message id recorded), attachment hashes equal the approved snapshots (CV PDF about 29 KB, letter PDF about 24 KB), and a recipient outside the allowlist is refused. Delivery evidence (`DELIVERED`) needs the provider's webhook; until then `PROVIDER_ACCEPTED` is the honest state.
* An earlier attempt with a synthetic `@example.com` candidate failed with the provider's validation error; the exact request, replayed to the provider's own discard address, was accepted, so the rejection came from the reserved synthetic copy address, not from the product. Real candidates use real addresses.
* **Blocked, external:** live mode refuses to start without `EMAIL_APPLY_WEBHOOK_SECRET`. The provider key installed on the host is send-only (401 on webhook management), so the engineer cannot create the webhook. The founder creates it in the Resend dashboard (endpoint `https://aisehr.com/backend/webhooks/resend`; events sent, delivered, delivery_delayed, bounced, complained, failed) and hands over its signing secret with `scripts/enter-secret.sh resend-webhook` (private file, never chat). The founder also confirms the test message (one e-mail with two PDF attachments, plus the candidate's own copy) arrived in the `ceo@aisehr.com` inbox. After both, enabling is: `EMAIL_APPLY_ENABLED=true`, `EMAIL_APPLY_TRANSPORT=live`, `EMAIL_APPLY_FROM`, the secret, `EMAIL_APPLY_REAL_RECIPIENTS=true`, automation off, API recreate. Mandatory candidate approval is enforced in the product and was exercised above. Today the production catalogue has no vacancy with a published e-mail address, so the feature would show nothing to candidates anyway.

### Admin
* The stored admin login works (SUPER_ADMIN, permissions listed by the API, MFA not yet enabled). Used only through a private script that never prints the credentials. A fresh MFA setup was started and its QR code was sent to the founder privately; enrolment completes when the founder gives the 6-digit code (see the final report).

## 4. Final status of the launch release (updated after the second authorization)

### Release, CI, backup
* Production release **`c96ace2dee30`** (main `c96ace2dee30cc391b723b10f5e2d67aad6b3a82`, merge of PR 34). **CI: success on that exact commit.** Images: API `sha256:54546a30728a…` (label revision = c96ace2), web `e5fe5fe17c4f…`, matching `82a8565cf4c9…`. Main now also contains PR 35 (`bb026f9`, scripts and docs only; no production rebuild needed). No database migration in this release (47 applied, none rolled back).
* Backup gate before this deploy: set **`20261009T132600Z`**, restore test **PASSED** on the founder's Mac, off-host destination **bucket VERIFIED** (earlier set `20261009T122411Z` before the first deploy of the day).
* `verify-deployment.sh` with `EXPECT_PAYMENTS=true EXPECT_DOCUMENTS=true`: all checks passed; preflight passed.

### Feature flags in production (host `apps/api/.env`, set only through `scripts/host-config.sh flag`)
| Flag | Value |
|---|---|
| `DOCUMENT_GENERATION_ENABLED` | `true` |
| `PAYMENTS_ENABLED` | `true` (live Dodo, Plus 8 / Premium 15 AZN; retired plans refused) |
| `SOURCE_SCHEDULE_ENABLED` | `true` (cron `SOURCE_ALLOWLIST=glorri,xsolla`) |
| `EMAIL_APPLY_ENABLED` | unset = **off** (automation `EMAIL_APPLY_AUTOMATION_ENABLED` off) |
| Google sign-in | on (unchanged) |

### Xsolla pilot (business decision B; not Xsolla's written permission)
* Registry: `xsolla` scheduled, interval 1,440 min (set through the admin API before the flag was switched on). The scheduler registered its repeating tick at 13:29 UTC. **First scheduled run 2026-10-09 13:30:00 → 13:30:09 UTC, started by the scheduler tick (not run-now), `SUCCEEDED`, `listingComplete=true`**; `nextRunAt` moved 24 h to 2026-10-10 13:30:09.
* **Counts (production database, never mixed with any isolated figure):** before, public-eligible catalogue **1,260**, Xsolla vacancies 0, Xsolla runs 0; after, **1,299** public-eligible (+39), **39 Xsolla vacancies, all active and public** (Baku roles, application link `jobs.lever.co/xsolla/...`). Glorri unchanged and still on its own hourly importer (3 runs in the previous 3 h); only `glorri` and `xsolla` ran.
* Controls: the global pause (`PUT /admin/ops/scheduler/pause`) was switched on and off (flag `import.scheduled` back to not paused); isolation, leases, cooldown and pause are proven by `apps/api/test/pilot-isolation-check.ts` on a copy of the registry. The 15-minute health check at 13:45 UTC reported: vacancy sources fresh, none in cooldown, none outside the allowlist (`glorri,xsolla`). The 13:30 health run (a few seconds before the run finished) raised a transient "never run" alert, and a disk alert (14% free) was cleared by removing superseded release images by name (17% free). PAŞA Sığorta untouched, no permission e-mail sent, Glorri importer unchanged.

### Documents
* First production journey: 40 of 41 checks passed; the single failing check was the journey's own number check flagging `189`/`1141`, which are the employer's street address taken from the vacancy's location field. **That check was fixed (the location field is now a legitimate number source) and two controls were added (the address numbers are accepted; an invented figure `98765` is still flagged). Re-run on production on the deployed image: 43 of 43 checks passed, 0 failed** (quote, generate, retry replay, review, approve, snapshot hash equality, allowance 2 of 5, Plus 30, Premium uncapped, synthetic account deleted, nothing left).

### E-mail applications
* Real-provider isolated run: 24 of 24 passed; provider accepted exactly one message to `ceo@aisehr.com` (`PROVIDER_ACCEPTED`, id recorded), CV and letter PDFs attached with hashes equal to the approved snapshots. **Production stays off** until the founder confirms receipt of the test message and its two PDF attachments and the signed-webhook check passes with the real signing secret.
* Webhook verification harness (`JOURNEY_WEBHOOK_CHECK=1`, isolated stack, deployed image, sink transport): signed delivery event applied (state `DELIVERED`), same event delivered twice recognised as a duplicate, unsigned / forged-signature / stale (1 h) / altered-body events rejected with 401 and changing nothing, late bounce accepted as evidence. **Rehearsed with a made-up secret: 34 of 34 checks passed.** It has not yet been run with the real Resend secret (the secret does not exist until the webhook is created in the Resend dashboard, which needs the founder's login).

### Analytics (GA4)
* The site sends only the path (`page_location` without query string; consent-gated; sensitive token routes excluded). **A production check on 9 Oct showed that GA's Enhanced-measurement "site search" still transmits the search term: the `view_search_results` event carries `ep.search_term` (for `/jobs?q=...`).** It can only be turned off in the GA property (Admin → Data streams → web stream → Enhanced measurement → Site search), which needs the founder's Google login. Not yet verified off.

### Rollback (inspected and proven without touching production)
Tags are named by what they replace: **`aise-api:pre-<X>` is the image that was running immediately BEFORE release `<X>`**. The report line "`rollback-images.sh c96ace2dee30 api`" is therefore the right command, but its name is easy to misread: it restores the *previous* image, not the current one.
| Record on the host | Image | Built from |
|---|---|---|
| `aise-api:latest` (running) | `54546a30728a` | `c96ace2dee30` (this release) |
| `aise-api:pre-c96ace2dee30` | `aecc6b53f230` | `35bafa04` (previous production API, the one with documents but without the retired-plan fix) |
| `aise-api:pre-72fba90e34a0` | `5375c1e388cc` | `72fba90e` (older) |
Proof (throwaway `drill-api` tags with a dry-run compose, production not touched): the script moved `latest` from `54546a30728a` to `aecc6b53f230`, whose revision label is `35bafa04…`. The running container stayed on `54546a30728a`, ready.
**Correct procedure** (the previous image still accepts the retired plan ids, so payments must be switched off first; no migration needs undoing):
```bash
cd /srv/stacks/aise
scripts/host-config.sh flag PAYMENTS_ENABLED false
RELEASE_SHA=715f7832635728a7358efb5f4f9a368a1a3ca39c ./scripts/rollback-images.sh c96ace2dee30 api
curl -fsS http://127.0.0.1:4000/health/ready   # release should read 715f78326357
```
Without the `RELEASE_SHA=` prefix the API would report an empty release id. Switch a single feature off instead with `scripts/host-config.sh flag <NAME> false` and `RELEASE_SHA=c96ace2dee30cc391b723b10f5e2d67aad6b3a82 docker compose up -d --no-deps api`.

### Open items needing the founder's participation
1. Sign in to the Resend dashboard (and to Google Analytics) in the Browser pane or connect Claude in Chrome, so the webhook can be created and GA Enhanced measurement turned off; or do those two clicks directly.
2. Confirm the test message and its two PDF attachments arrived in `ceo@aisehr.com`.
3. Enter the 6-digit authenticator code in the private terminal prompt (admin MFA).

## 5. Browser agent release and remaining launch items (10 October 2026)

### Release `0b86722` (PR 37, merge commit; CI success on that exact commit)
* Images: API `sha256:d0e301ae8fc0…` (label revision `0b86722`), web `sha256:0df9dcebbf9b…` (contains the extension zip), matching `82a8565cf4c9…` unchanged. Backup gate: set **`20261009T201618Z`**, restore test **PASSED** on the founder's Mac (schema of the previously deployed code), off-host destination **bucket VERIFIED**. Migration `20261020090000_browser_agent` (additive, 6 tables) applied on start: **48 migrations, none rolled back**. `verify-deployment.sh` (documents, payments and agent expected on; autonomous mode must be off): all checks passed.
* **Flags now:** `BROWSER_AGENT_ENABLED=true` (**assisted mode only**), `BROWSER_AGENT_AUTONOMOUS_ENABLED` unset (autonomous OFF: no portal is verified for it), documents on, payments on, scheduler on, e-mail applications off.
* **Production smoke test** (throwaway account, no employer contacted, account deleted afterwards): capabilities `enabled/assisted`, `autonomous:false`, Lever listed with live submission `UNVERIFIED`; an autonomous campaign refused (403 `AUTONOMOUS_DISABLED`); consent refused without acknowledgement (400) and created with it; pairing code → device → `next` = no work; unauthenticated device call 401; nothing queued for an account without matches; revoke; cleanup left 0 users and 0 campaigns. The extension zip is served (200, 11,756 bytes); `/dashboard/agent` requires sign-in.
* **Rollback (verified tags, see §4 for the semantics):** `aise-api:pre-c96ace2dee30` = revision `c96ace2` and `aise-web:pre-c96ace2dee30` = revision `72fba90`. Switch the agent off first (`scripts/host-config.sh flag BROWSER_AGENT_ENABLED false`), then `RELEASE_SHA=c96ace2dee30cc391b723b10f5e2d67aad6b3a82 ./scripts/rollback-images.sh c96ace2dee30 api web`. The migration is additive and stays; the old code ignores the new tables. Older targets kept: `aise-api:pre-35bafa04910c` (`35bafa0`).

### GA4 search terms: stopgap live and verified; dashboard switch still pending
Found 9 Oct: Enhanced measurement "site search" sent the search term. This release stops all GA collection while a search term is in the address (`q`, `s`, `search`, `query`, `keyword`, `kw`, `term`), at load and after in-page navigation (unit-tested). **Verified on production traffic on 10 Oct:** `/jobs?q=sql+analitik` and a search typed into the page produced **zero** GA hits and the disable flag was set; `/jobs` without a query produced one clean `page_view` (`dl=https://aisehr.com/jobs`, no term). The proper fix (turn Enhanced measurement → Site search off in the GA property) still needs the founder's Google sign-in; the stopgap can then be removed.

### Still open (need the founder's participation, nothing else blocks them)
1. **Resend and Google sign-in** in the in-app Browser pane (pages are open at `resend.com/login` and Google Analytics): after sign-in the engineer creates the Resend webhook (`https://aisehr.com/backend/webhooks/resend`; sent, delivered, delivery_delayed, bounced, complained, failed), stores its secret privately, runs `JOURNEY_WEBHOOK_CHECK=1` with the real secret (rehearsed 34/34 with a made-up one), turns GA Enhanced measurement off, and enables e-mail applications once receipt of the test message and its two PDFs is confirmed.
2. **Confirm the test message** (one e-mail, two PDFs, plus the candidate's copy) in the `ceo@aisehr.com` inbox.
3. **Admin MFA:** a private prompt in Terminal tab "Admin MFA enrolment (private)" has a QR on the Mac's screen and waits for the 6-digit code (a new QR is issued automatically if the challenge expires). Recovery codes are saved privately (mode 600), never printed.
