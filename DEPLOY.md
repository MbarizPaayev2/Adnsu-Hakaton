# Deploying AISE

The stack runs from `docker-compose.yml` on a single host, behind a reverse
proxy that already exists on that host.

**The host is currently a machine at the CTO's home.** That rules out the
obvious approach: GitHub cannot open an SSH connection to a machine behind a
home router, so the `ssh` mode of the Deploy workflow will not work there
without port forwarding or a tunnel — neither of which is worth doing just to
deploy.

Two ways that do work:

### 1. Run it on the machine (simplest, works today)

```bash
cd /path/to/aise
git fetch origin
./scripts/deploy.sh main
```

Nothing else to set up. No secrets, no runner, no exposed ports. This is the
whole deploy — the workflow below only ever calls this same script.

### 2. Install a self-hosted runner (if you want the button)

A runner installed on that machine polls GitHub *outbound*, so nothing has to
be reachable from the internet and no SSH key goes into GitHub:

Settings → Actions → Runners → *New self-hosted runner*, follow the shown
steps on the machine, then run it as a service so it survives a reboot:

```bash
sudo ./svc.sh install
sudo ./svc.sh start
```

Add one secret, `DEPLOY_PATH` — the absolute path of the clone the stack runs
from (the runner's own workspace is a different directory). Then
Actions → *Deploy* → *Run workflow* with mode `self-hosted`.

The `ssh` mode is kept in the workflow for a future host with a real address;
it needs the `DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_SSH_KEY` secrets listed below.

---

## Host prerequisites

One-time setup on the server:

1. **A clone of this repo**, on a branch that can be reset to `origin/main`.
   `scripts/deploy.sh` runs `git reset --hard`, so the checkout must not carry
   local commits. It refuses to run on a dirty tree.

2. **Docker with the Compose plugin** (`docker compose version`).

3. **The `proxy` network**, which `api` and `web` join as an external network:

   ```bash
   docker network create proxy
   ```

   Your reverse proxy (Traefik, Caddy, nginx-proxy) must be attached to it and
   route `aisehr.com` → `web:3000` and the API host → `api:4000`.

4. **Three env files.** All gitignored, so they survive the reset — but that
   also means *nothing creates them for you*.

   | File | Why it must exist |
   | --- | --- |
   | `.env` | Compose interpolates `NEXTAUTH_SECRET`, `MATCHING_SERVICE_TOKEN`, `APPLY_WORKER_TOKEN` with `:?`, so it aborts if they are unset. |
   | `apps/api/.env` | Loaded via `env_file`. Holds `DATABASE_URL`, Redis, Dodo Payments, Resend, PostHog and the service tokens. |
   | `apps/web/.env.local` | `NEXT_PUBLIC_*` are inlined into the client bundle **at build time**. Setting them in compose does nothing. |

   `scripts/deploy.sh` checks for all three before touching anything.

---

## GitHub secrets

Set under Settings → Secrets and variables → Actions.

For **self-hosted** mode, one secret is enough:

| Secret | Value |
| --- | --- |
| `DEPLOY_PATH` | Absolute path to the clone the stack runs from |

For **ssh** mode (a host with a reachable address) add:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | Server hostname or IP |
| `DEPLOY_USER` | SSH user (needs docker permissions) |
| `DEPLOY_SSH_KEY` | Private key, full PEM including header/footer |
| `DEPLOY_PORT` | Optional, defaults to 22 |

The workflow targets a `production` GitHub Environment. Adding required
reviewers there gates every deploy behind an approval.

Use a deploy-only key: generate a fresh pair, put the public half in that
user's `authorized_keys`, and give the private half to GitHub. It is never
printed by the workflow.

---

## What a deploy does

1. Re-runs CI's checks (typecheck + tests for `apps/api` and `apps/web`)
   against **the exact ref being deployed** — a manual deploy can name a ref
   CI never saw.
2. SSHes in and runs `scripts/deploy.sh`, which:
   - refuses to continue on a dirty tree, and records the current commit in
     `.last-deployed-commit` for rollback;
   - fetches and hard-resets to the target ref;
   - **builds images before stopping anything**, so a compile failure leaves
     the running stack untouched;
   - `docker compose up -d --remove-orphans`;
   - health-checks `api` on :4000 and `web` on :3000, printing the last 60 log
     lines of whichever service failed.

### Migrations

`apps/api/Dockerfile`'s `CMD` is
`npx prisma migrate deploy && node dist/main.js`, so **migrations run when the
API container starts**. There is intentionally no migration step in the deploy
script — adding one would duplicate the work or race the container doing it.

Two consequences worth knowing:

- A deploy carrying a migration changes production data as soon as the new API
  container starts. Review migrations before deploying.
- The API's first health response can lag on a long migration. That is why
  the health check allows 120s (`HEALTH_TIMEOUT`).

### Which images get rebuilt

Defaults to `api web`. `matching-service` and `apply-worker` are excluded
because their images are expensive to build (PyTorch and a headless browser)
and change rarely. Rebuild them explicitly when they change:

```bash
SERVICES="api web matching-service apply-worker" ./scripts/deploy.sh main
```

---

## Rollback

Re-deploy the previous commit. The script prints the exact command when it
finishes, and the host keeps it in `.last-deployed-commit`:

```bash
./scripts/deploy.sh "$(cat .last-deployed-commit)"
```

Or re-run the Deploy workflow with that SHA as the ref.

**A rollback does not undo a migration.** Prisma has no automatic down
migrations, so a deploy that migrated the schema needs a forward-fixing
migration, not a code rollback.

---

## Restarts and status (no restart button)

The admin panel no longer restarts containers, and the API no longer mounts
the Docker socket (removed before the 5 October release: anything holding
that socket has root-equivalent control of the host). `/admin/system` shows
the release SHA, environment, dependency health and backup/restore-test age
only.

Restart a service on the host, as the operator:

```bash
docker compose restart api          # or web / apply-worker / matching-service
curl -fsS http://127.0.0.1:4000/health/ready
```

Use `scripts/deploy.sh <sha>` for anything that changed code. Host-side
monitoring is `scripts/check-health.sh` (cron); see
`docs/release-2026-10-05.md`.

---

## Why it is manual

Uncommenting the `push` trigger in `.github/workflows/deploy.yml` turns this
into deploy-on-merge. Two reasons it is not the default yet:

1. **The legal pages carry placeholders.** Registered entity name, address,
   VÖEN and the contact mailboxes still render as visible placeholders
   (`grep -rn "TODO(legal)" apps/web/src`), and each document says it needs a
   lawyer's review. Publishing those is worse than publishing nothing. Dodo
   Payments also requires reachable terms, privacy and refund URLs for a live checkout.
2. **One production database**, migrated automatically on container start.

Once the legal text is signed off, auto-deploy is a one-line change.

---

## Pre-deploy checklist

- [ ] Legal placeholders filled in and reviewed
- [ ] Any new migration read and understood
- [ ] `apps/web/.env.local` on the host has the correct `NEXT_PUBLIC_API_URL`
      (baked in at build time — a wrong value means a rebuild, not a restart)
- [ ] New env vars added to the host's env files *before* deploying
- [ ] Cookie consent decided if PostHog is enabled in production (analytics
      cookies are non-essential; see `/cookies`)

## Known gaps outside this repo

Two production issues cannot be fixed from the application code, and both need
the reverse proxy / DNS in front of the host:

- **`http://aisehr.com` answers 200 instead of redirecting to HTTPS.** Every
  first-ever visit is therefore open to interception. The app now sends
  `Strict-Transport-Security` with `preload`, which protects every subsequent
  visit, but the redirect itself has to be a Caddy (or Cloudflare) rule.
- **`https://www.aisehr.com` returns 404.** The `www` host is not routed.

Also worth deciding: the site runs from a machine at home, so uptime is bounded
by that machine's power and internet connection, and Postgres lives on the same
box as the app with a compose named volume (`pgdata`) and no off-machine backup
configured anywhere in this repo. A `pg_dump` to somewhere else is the smallest
useful step.
