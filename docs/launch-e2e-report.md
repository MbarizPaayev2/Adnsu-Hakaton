# AISE launch readiness — evidence report

> **Superseded for the 5 October 2026 release by [`release-2026-10-05.md`](release-2026-10-05.md).** Kept for history: its results were not re-run for that release and must not be quoted as current.

**Prepared:** 6 September 2026
**Candidate SHA at time of writing:** see `git rev-parse HEAD` (work below is uncommitted-then-committed in one change; the exact SHA is in the commit that adds this file)
**Production SHA observed:** approximately `abd3532` (fingerprinted, see §2)
**Intended launch:** 7 September 2026 — *confirm before acting on this document*

## 1. Recommendation

**NO-GO for paid launch. LIMITED LAUNCH is technically achievable for the free tier.**

Split deliberately, because the two are blocked by different things:

| | Status | Blocked by |
|---|---|---|
| Technical readiness | Not established | No end-to-end journey has been executed against a running stack (§4) |
| Payment readiness | **Blocked** | Enum defect (§3.1) + unset webhook key + exposed key not rotated |
| Legal readiness | **Blocked** | No registered entity; live site still serves placeholder legal pages |
| Auto-apply readiness | **Blocked** | Never verified against the real recipient; consent defect (§3.4) |

This is not a deadline-driven downgrade. §3 lists defects proven by execution, each of
which independently prevents a correct paid launch.

## 2. What is actually deployed

The previous handoff claimed "fixes remain undeployed". That is **wrong**, and was
corrected by fingerprinting the live site rather than trusting the claim:

| Marker | Live? | Implies |
|---|---|---|
| `<html lang="az">` | yes | post-`931ba7d` code is deployed |
| HSTS header present | yes | post-`d4be3e4` deployed |
| `robots.txt` with `Disallow: /admin` | yes | our `robots.ts`, not Cloudflare's default |
| `x-powered-by` absent | yes | `poweredByHeader: false` deployed |
| `/checkout` returns 200 | yes | the CTO's `abd3532` deployed |
| `/legal`, `/service-providers`, `/employer-terms` | **404** | `6515ced` **not** deployed |
| `/terms` contains "Hüquqi baxış tələb olunur" and "hüquqi şəxsin adı" | **yes** | **placeholder legal text is publicly live right now** |

**These fingerprints bound the deployed code; they do not identify a SHA.** They show
the live build contains `abd3532`-era changes and does not contain `6515ced`, which is
enough to conclude the legal-page rewrite is not live. It is not enough to name the
deployed commit: the build could be any commit in that range, or a local build never
pushed. The exact SHA can only come from the host (`git rev-parse HEAD` in the deploy
directory, or the image label) — recorded as an owner action, not inferred here.

What is certain: the placeholder legal text is publicly live right now on a site that
takes payments.

## 3. Defects found and fixed in this pass

Each was proven by execution, not inferred.

### 3.1 `SubscriptionPlan` enum mismatch — paid upgrades cannot work (CRITICAL)

`schema.prisma` declares `Limitsiz`; the database holds `UNLIMITED`; **no migration
existed for the rename.** Proven:

```
ERROR: invalid input value for enum "SubscriptionPlan": "Limitsiz"
```

Two live consequences:

* a successful payment **cannot** be converted into an entitlement — the write throws;
* anyone already on `UNLIMITED` is refused the features they paid for, because every
  gate reads `plan !== 'Limitsiz'` (`external-apply.service.ts`, `resumes.service.ts`).

`prisma migrate deploy` would not have fixed this — there was nothing to apply.

**Fixed:** `20260906180000_rename_unlimited_plan_to_limitsiz`, using
`ALTER TYPE ... RENAME VALUE` so existing rows keep their tier with no data migration.
Guarded, so it is a no-op where already corrected. Applied locally; `prisma migrate diff`
then reports **"No difference detected"**, and the previously-failing write succeeds.

### 3.2 Uploaded files were never persisted (CRITICAL)

`LocalStorageService` writes to `process.cwd()/uploads`; the image's WORKDIR is
`/repo/apps/api`; the api service mounted **only** the Docker socket. No volume existed
for uploads anywhere in `docker-compose.yml`.

Every uploaded CV, generated CV, **identity-document photo** and application attachment
is written to the container's writable layer. `Resume.fileUrl`, `Profile.idDocumentUrl`
and `ApplicationFile.fileUrl` keep pointing at them regardless.

**Correction to an earlier version of this document.** It claimed those files are
destroyed "on the next restart — including by the admin panel's own restart button".
That is wrong. A container's writable layer survives `docker restart` (a stop/start of
the same container), so the admin restart button does **not** destroy uploads. The loss
event is container *replacement*: `docker compose up -d` with a rebuilt image, or any
`docker rm`. That is precisely what a deploy does, which is why the preservation step in
the runbook has to run before the deploy, not before a restart.

**Fixed:** named `uploads` volume mounted at `/repo/apps/api/uploads`.

**Not fixed by that alone:** any file uploaded before the volume exists is either already
gone or still inside the current container. See the runbook — legacy uploads must be
copied out **before** the container is replaced, or they are lost at deploy time.

### 3.3 Dry-run submissions could be sent for real (CRITICAL)

`external-apply.service.ts` read:

```ts
const dryRun = dto.dryRun === true && process.env.ENABLE_SANDBOX === 'true';
```

A dry run requested with sandbox off silently became `false` and continued into
`confirmSubmit()` — a real application, delivered to a real employer, on a real
candidate's behalf, while the caller believed nothing was sent.

**Fixed:** the impossible combination is now rejected. The anti-spoofing intent is kept
(dryRun honoured only when the server enables sandbox mode) but a dry-run request is
never reinterpreted as a live send.

### 3.4 Third-party privacy declaration accepted without authority (CRITICAL, legal)

`glorri-apply.adapter.ts` ticked the recipient's `isDataPrivacyAccepted` box
unconditionally, twice, without the candidate having seen that notice. This contradicts
AISE's own published `/application-authorization` page, and the legal pack flags it as a
launch blocker.

**Fixed:** fails closed. Without recorded authority the box is left untouched and
reported as an outstanding required field, so the flow asks instead of deciding.

**Still required before live use:** per-recipient authority must be threaded from the
consent UI through the API to the worker, and the recipient's actual notice shown. Until
then the field simply blocks the flow.

### 3.5 Submission success claimed from absence of an error (CRITICAL)

The adapter returns `SUBMITTED` when there is no OTP field and no visible error text. Its
own comments state the live-submit path "was never run to completion against the real
site" and that this is "an unverified placeholder, not a validated success signal".

**Not fixed.** Correcting it needs a distinct "sent, delivery unconfirmed" state
(enum + API + UI), and adding an enum value under time pressure is precisely what caused
§3.1. Instead, live external apply is gated off by default
(`EXTERNAL_APPLY_LIVE_ENABLED`, see §5).

### 3.6 Dodo checkout misconfiguration

Product ids fall back to `mock_basic`; against the live account that returns
`422 INVALID_REQUEST_PARAMETERS: Product mock_basic does not exist`. `DODO_ENV` unset
means the SDK uses the **test** endpoint with a live key and 401s.

**Fixed:** `BillingService` refuses to boot when a real key is paired with missing or
leftover-mock product ids, or an unset `DODO_ENV`. Verified against the live account that
real product ids return 200 with a usable checkout URL. Configuration itself is an owner
action (§6).

## 4. Workflow matrix

Honest result codes. **NOT RUN is not a pass.**

| ID | Workflow | Result | Evidence |
|---|---|---|---|
| INF-1 | Postgres backup + encrypted archive + verify | **PASS** | `scripts/backup.sh` executed; 992K db + uploads archive, both verified |
| INF-2 | Restore into isolated database, no errors | **PASS** | `scripts/restore-test.sh` step 2 |
| INF-3 | Restored schema matches datamodel | **PASS** | step 3, after §3.1 fix; caught real drift before it |
| INF-4 | Row counts match manifest | **PASS** | 6 tables compared |
| INF-5 | DB/file consistency detected when broken | **PASS** | correctly FAILED on a deliberately-missing file, then passed when supplied |
| INF-6 | Missing manifest fails closed | **PASS** | verified after hardening |
| DATA-1 | Stub-CV detector: flags exact stub output | **PASS** | 7/7 unit tests |
| DATA-2 | Detector does NOT flag a genuine CV with the same three skills | **PASS** | explicit false-positive test |
| DATA-3 | Repair tool dry-run against a database | **NOT RUN** | Nest context boot exceeded 10 min on this host |
| PAY-1 | Live product ids produce a checkout session | **PASS (live API, read/create only)** | HTTP 200 + checkout_url; no payment made |
| PAY-2 | Sandbox payment → webhook → entitlement | **NOT RUN** | needs sandbox credentials + a reachable webhook endpoint |
| PAY-3 | Webhook signature verification | **PASS (by inspection)** | fails closed without key; plan resolved from `product_id`, not client metadata |
| PAY-4 | Duplicate webhook delivery is harmless | **PASS (by inspection)** | all handlers are absolute writes, not increments; quota untouched |
| PAY-5 | Out-of-order webhook ordering | **FAIL (by inspection)** | no timestamp guard; a late `active` can overwrite `cancelled` |
| SEC-1 | Cross-tenant application access refused | **PASS** | earlier session: 404 for the other employer, read and write |
| SEC-2 | Token confusion between user/employer/admin | **PASS** | earlier session: 401 both directions |
| WEB-1 | Production web build | **PASS** | `next build` succeeded, all 12 legal routes static |
| WEB-2 | Landing/legal pages render in a browser | **NOT RUN** | dev server would not bind on this host |
| E2E-A..H | Signup, onboarding, matching, tailoring, native apply, external apply, privacy | **NOT RUN** | see §7 |

## 5. Feature gate

`EXTERNAL_APPLY_LIVE_ENABLED` defaults to **off**. With it off, creating an external
application is refused with an Azerbaijani message directing the candidate to apply at
the source, and no browser session is started.

This is a **scope decision for the founder, not an engineering preference.** Turning it
on is one environment variable. What is unresolved before doing so:

1. the adapter has never completed a real submission against the live site (§3.5);
2. success is inferred from the absence of an error (§3.5);
3. per-recipient privacy authority is not yet threaded (§3.4).

Advertising working auto-apply while it is gated off would be a false public claim; the
landing page currently leads with it.

## 6. Owner actions

No secret values in this document, and none should be sent over chat.

| # | Action | Where |
|---|---|---|
| 1 | **Revoke and reissue the Dodo API key** — the previous value was pasted into a chat transcript | Dodo dashboard, then enter on the host in `apps/api/.env` |
| 2 | Set `DODO_ENV=live_mode` and the three `DODO_PRODUCT_ID_*` values | host `apps/api/.env` |
| 3 | Set `DODO_WEBHOOK_KEY` — without it webhooks fail closed, so paid upgrades never apply | host `apps/api/.env` |
| 4 | Set `AISE_BACKUP_AGE_RECIPIENT` (or GPG) and store the private key **off** the host | host environment + your key store |
| 5 | Add the HTTP→HTTPS redirect and route `www` | Caddy / Cloudflare |
| 6 | Decide the operating entity, or accept launching with no identified contracting party | founder + Azerbaijani counsel |
| 7 | Decide the auto-apply scope question in §5 | founder |
| 8 | Confirm `support@aisehr.com` actually receives mail | mail provider |

## 7. What was not verified, and why

This host could not run the journeys: `nest start` and the repair script's Nest context
both exceeded 10 minutes, `next build` took 6.4 minutes, `next dev` would not bind, and
jest runs stalled under load. Every "NOT RUN" above is that, not an omission of intent.

Consequences to be honest about:

* No user journey has been executed end to end against a running stack in this pass.
* Fixture accounts, mail sink, ATS fixture and browser traces were **not** created.
* The Glorri adapter remains unverified against any recipient, fixture or live.
* Concurrency, soak, health/readiness endpoints and monitoring were not built.

A route that builds is not a working journey, and none of the above should be read as one.
