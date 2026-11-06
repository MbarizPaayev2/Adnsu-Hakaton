# AISE launch runbook

> **Superseded for the 5 October 2026 release by [`release-2026-10-05.md`](release-2026-10-05.md).** Kept for history: its results were not re-run for that release and must not be quoted as current.

Companion to `docs/launch-e2e-report.md`, which records what is and is not verified.
Read that first — this procedure assumes its blockers have been resolved or accepted.

`DEPLOY.md` remains the reference for host prerequisites and the two deploy modes.

## 0. Before the window

| | |
|---|---|
| Operator | the person with shell access to the host (the CTO's machine) |
| Release SHA | **an explicit 40-character SHA, never `main`** — see below |
| Window | choose one where the operator can watch for an hour afterwards |
| Abort authority | founder |

### Deploy an immutable SHA, not a branch

`scripts/deploy.sh main` resolves `main` **on the host at run time**. If the host's
`main` is stale, or moves between verification and deploy, you ship something no one
checked. Always:

```bash
git fetch origin
git rev-parse origin/main          # note this value
./scripts/deploy.sh <that-40-char-sha>
```

The script hard-resets to the ref you name, so a SHA is unambiguous where a branch name
is not.

## 1. Preserve legacy uploads — do this FIRST

**Before any deploy that includes the new `uploads` volume.** Until now uploaded files
lived inside the API container's writable layer (`launch-e2e-report.md` §3.2). Replacing
the container destroys them, and mounting an empty volume over the path hides whatever is
left.

```bash
# 1. Is there anything to save?
docker exec aise-api sh -c 'ls -la /repo/apps/api/uploads 2>/dev/null | head' || echo "no uploads dir"
docker exec aise-api sh -c 'find /repo/apps/api/uploads -type f | wc -l'

# 2. Copy it OUT of the container, to the host.
docker cp aise-api:/repo/apps/api/uploads ./uploads-legacy-$(date -u +%Y%m%dT%H%M%SZ)

# 3. Record checksums so the restore can be verified.
find ./uploads-legacy-* -type f -exec shasum -a 256 {} \; > uploads-legacy.sha256
wc -l uploads-legacy.sha256
```

Then, **after** the deploy has created the volume:

```bash
# 4. Load them into the volume the new container mounts.
docker run --rm -v aise_uploads:/dst -v "$PWD/uploads-legacy-<stamp>":/src:ro \
  alpine sh -c 'cp -a /src/. /dst/ && find /dst -type f | wc -l'

# 5. Verify every file arrived intact.
docker run --rm -v aise_uploads:/data:ro -v "$PWD":/w:ro alpine sh -c \
  'cd /data && sha256sum -c /w/uploads-legacy.sha256 2>&1 | grep -c OK'

# 6. Reconcile against the database: every referenced file must exist.
docker exec aise-postgres psql -U postgres -d aise -At -c "
  SELECT \"fileUrl\" FROM \"Resume\" WHERE \"fileUrl\" IS NOT NULL
  UNION SELECT \"idDocumentUrl\" FROM \"Profile\" WHERE \"idDocumentUrl\" IS NOT NULL
  UNION SELECT \"fileUrl\" FROM \"ApplicationFile\" WHERE \"fileUrl\" IS NOT NULL;" \
| while read -r u; do n="${u##*/}"; docker run --rm -v aise_uploads:/d:ro alpine \
    test -f "/d/$n" || echo "MISSING: $n"; done
```

If step 1 shows files and step 2 fails, **stop**. Do not deploy; the files are the only
copy.

## 2. Backup, and prove it restores

```bash
export AISE_BACKUP_AGE_RECIPIENT=<your age recipient>   # never commit this
./scripts/backup.sh /var/backups/aise
```

Manifest row counts are recorded **after** `pg_dump` finishes, so on a live system a
concurrent write makes a count differ by design. For a backup whose counts are meant to
be authoritative, pause writes first (§3).

Then actually restore it, into isolated throwaway resources:

```bash
export AISE_BACKUP_AGE_IDENTITY=<path to the private key>
./scripts/restore-test.sh /var/backups/aise/<stamp>-db.sql.gz.age \
                          /var/backups/aise/<stamp>-uploads.tar.gz.age
```

This must print **RESTORE TEST PASSED**. It fails closed on a missing manifest, a
mismatched row count, schema drift, or a database row pointing at a file the archive does
not contain. Record how long it took — that is your measured recovery time. Do not claim
a recovery objective you have not measured.

Copy both archives **off the host**. A backup on the machine whose failure it exists for
is not a backup.

## 3. Pause background work

The API registers repeatable jobs at boot (daily digest, hourly Glorri scrape,
external-apply sweep). Deploying mid-sweep risks duplicate notifications.

```bash
docker compose stop apply-worker matching-service
docker exec aise-redis redis-cli LLEN bull:external-apply:wait
docker exec aise-redis redis-cli LLEN bull:notifications:wait
```

Let the queues drain, or note their depth so you can tell a pre-existing backlog from one
the deploy caused.

## 4. Deploy

```bash
SERVICES="api web" ./scripts/deploy.sh <sha>
```

Rebuild the worker or matching service **as well** if either changed:

```bash
SERVICES="api web apply-worker matching-service" ./scripts/deploy.sh <sha>
```

`apps/api`'s container runs `prisma migrate deploy` on start, so **migrations apply the
moment the new API boots.** Read what is pending first:

```bash
docker compose run --rm --entrypoint sh api -c \
  'npx prisma migrate status --schema=apps/api/prisma/schema.prisma'
```

This release includes `20260906180000_rename_unlimited_plan_to_limitsiz`. It is an
`ALTER TYPE ... RENAME VALUE`, so it preserves every existing row's tier and is reversible
with the inverse rename. It is guarded and a no-op if already applied.

Expect roughly 8–12 minutes, dominated by the web image build.

## 5. Verify before resuming queues

```bash
curl -sS -o /dev/null -w 'api  %{http_code}\n' http://127.0.0.1:4000/
curl -sS -o /dev/null -w 'web  %{http_code}\n' http://127.0.0.1:3000/

# Public surface
curl -sS -o /dev/null -w 'https  %{http_code}\n' https://aisehr.com/
curl -sS -o /dev/null -w 'http   %{http_code} -> %{redirect_url}\n' http://aisehr.com/
curl -sS -o /dev/null -w 'legal  %{http_code}\n' https://aisehr.com/legal

# The enum fix actually landed
docker exec aise-postgres psql -U postgres -d aise -At -c \
  "SELECT string_agg(enumlabel,',' ORDER BY enumsortorder) FROM pg_enum e
     JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='SubscriptionPlan';"
# expect: FREE,BASIC,STANDARD,Limitsiz

# Nobody lost their tier
docker exec aise-postgres psql -U postgres -d aise -At -c \
  "SELECT plan, count(*) FROM \"Subscription\" GROUP BY plan;"

# Uploads survive a restart (the whole point of the volume)
docker compose restart api && sleep 20
docker run --rm -v aise_uploads:/d:ro alpine sh -c 'find /d -type f | wc -l'
```

`/` returning 200 is **not** a health check for the product. Until real readiness
endpoints exist, run at least one authenticated journey with a synthetic account.

Run the repeatable native-marketplace journey on the host:

```bash
ALLOW_E2E_DATA=1 ./scripts/smoke-e2e.sh
```

It verifies candidate and business registration, email verification, CV upload,
profile onboarding, matching, tailored-CV generation and download, native
application submission (including a required file answer), employer review,
application status updates, and vacancy pause/reactivate. It uses direct database
access only for synthetic-account setup (verification tokens, company approval,
and an unlimited test entitlement), then removes its accounts and files.

## 6. Resume queues

```bash
docker compose start matching-service apply-worker
docker exec aise-redis redis-cli LLEN bull:external-apply:wait
```

Watch for a burst of duplicate notifications in the first minutes. If one appears, stop
the worker again rather than letting it contact users.

## 7. Abort and rollback

**Abort if** the API does not become healthy, migrate status shows an unexpected
migration, `/legal` still 404s, the enum check prints `UNLIMITED`, or subscriber tiers
changed.

```bash
./scripts/deploy.sh "$(cat .last-deployed-commit)"
```

Understand precisely what that does and does not undo:

| | Reversed by a code rollback? |
|---|---|
| Application code | yes |
| The enum rename | **no** — run the inverse `ALTER TYPE ... RENAME VALUE` manually, and only if the old code is going back |
| Rows written after the deploy | **no** |
| Files uploaded after the deploy | **no** |

**Never restore the old database over a running system that has taken new payments or
applications since the deploy.** That trades a deployment problem for permanent data
loss. Roll the code back first, then decide about data with the founder.

## 8. First hour

Watch, with an owner named for each:

* API error rate and any 5xx burst
* `bull:*:failed` depth and stalled jobs
* Payment webhook failures — with `DODO_WEBHOOK_KEY` unset these fail closed and paid
  upgrades will not apply
* Backup age (the next scheduled run actually succeeding)
* Certificate expiry — the current certificate is valid to **25 November 2026**

Nothing here configures monitoring. Writing this section does not make it run; a
scheduled backup and an alert destination are separate, explicitly authorized work.
