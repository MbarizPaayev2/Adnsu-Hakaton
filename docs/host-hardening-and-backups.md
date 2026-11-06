# Host hardening, backups and monitoring — procedures (30 September 2026)

Everything here was prepared and **rehearsed on disposable containers**; nothing has been run on `tefma`. `tefma` is a shared home-network laptop (Ubuntu, 4 CPUs, 7.1 GiB RAM with swap heavily used, 16 GB disk free; Minecraft, Nextcloud, aella, Caddy, Portainer, Uptime Kuma and a Hyperledger stack share it). Nothing below builds an image, starts anything heavy, or touches other services' schedules, volumes or files.

**Who can do what.** `tefma` (deploy user, docker group) has no passwordless `sudo`, and the old WhatsApp password is not used by this work. No step below needs `sudo`: the three secret files sit in directories the deploy user owns, and a directory owner may replace a file in it (`host-config.sh secure-files` copies each file to a private temp file and renames it over the original: same content, new owner and mode, no privilege used). If a step does need `sudo`, it says so and stops.

## 0. Current state on `tefma` (read-only checks, 30 Sep 2026)

| Item | State |
|---|---|
| Running release | API `75754ea` (healthy), web and worker `3867b07`; `/health/ready` 200 |
| Published ports | all six on `127.0.0.1`; from the tailnet `3000, 4000, 5433, 6379, 8000, 8100` are closed (port 80 Caddy, 9000 Portainer, 3001 Uptime Kuma are other services) |
| Secret files | `.env`, `apps/api/.env`, `apps/web/.env.local` are `root:root 0644`; `docker compose config -q` passes today |
| `ADMIN_MFA_ENCRYPTION_KEY` | **unset** — admins cannot enrol MFA |
| `PAYMENTS_ENABLED` | **unset** (checkout is off only because the code requires the exact value `true`); the Dodo key is a live key |
| `EXTERNAL_APPLY_LIVE_ENABLED` | unset (off, correct) |
| `APP_ENV`, `RELEASE_SHA` | set (`APP_ENV` defaults to `production` in compose; `deploy.sh` sets the release) |
| Database password | the well-known default (`POSTGRES_PASSWORD` unset) — reachable only from inside the host now |
| Backups | no crontab for `tefma`; 3 manual encrypted sets in `~/aise-backups`; `/var/backups/aise/status` (what the admin panel reads) is an empty root-owned directory, so `/admin/system` shows "unknown" |
| Off-host | one copy of each set on the founder's Mac (laptop, sleeps); no durable destination; `rclone` is not installed on `tefma` (`age`, `python3`, `openssl` are) |
| Web build inputs | `apps/web/.env.local` also holds `DATABASE_URL` and `NEXTAUTH_SECRET`; the web code reads only `NEXTAUTH_SECRET` at runtime, and compose supplies it from the root `.env`, so neither is needed by the build (the build of 29 Sep passed with only `NEXT_PUBLIC_*`) |

## A–C. Configuration that must be in place BEFORE the new API starts (one ordered sequence, no downtime until the API is recreated)

Run from the new release's scripts (a worktree of the release commit, `AISE_DIR=/srv/stacks/aise`), as `tefma`:

```bash
export AISE_DIR=/srv/stacks/aise
scripts/host-config.sh secure-files    # deploy user owns .env, apps/api/.env, apps/web/.env.local, mode 600; compose config -q must say ok
scripts/host-config.sh web-env         # apps/web/.env.local keeps only NEXT_PUBLIC_*; the previous copy is kept (mode 600)
scripts/host-config.sh payments-off    # PAYMENTS_ENABLED=false (refuses to overwrite "true")
scripts/host-config.sh app-env         # APP_ENV=production in .env if absent
scripts/host-config.sh mfa-key         # ADMIN_MFA_ENCRYPTION_KEY if ABSENT; an existing key is never replaced
scripts/host-config.sh backup-status   # BACKUP_STATUS_DIR in .env = ~/aise-backups/status (what the API mounts read-only)
scripts/host-config.sh preflight       # every line PASS, else do not start the new API
```
External live auto-apply stays disabled (`EXTERNAL_APPLY_LIVE_ENABLED` unset; the preflight fails if it is `true`). Use `docker compose config -q`, never `config --services`, to test that compose reads the secret files.

**Founder key custody (the moment the key exists).** The MFA key is only in `apps/api/.env`. On the server terminal run `grep '^ADMIN_MFA_ENCRYPTION_KEY=' apps/api/.env`, copy the value into the founder's password manager as "AISE admin MFA encryption key", confirm it is saved; never paste it into chat, email or a ticket. Losing it makes every enrolled authenticator unreadable (re-enrol with `npm run script:admin-recover:prod`, which needs server access). Never change it while authenticators are enrolled. Put a second copy where the backup private key is kept.
**Then** the founder signs in to `/admin`, enrols MFA, and saves the recovery codes.
**Rollback:** `.bak.*` copies (mode 600) are created beside each edited file; ownership needs no rollback.

## D. Rotate the default database password (after the new release is running; 1–2 minutes of API restart)

**Hard prerequisite — one identifiable backup set, proven end to end** (`scripts/check-backup-evidence.py`, also run by the dry run):
the set's archives and manifest verify (each archive hashes to the manifest); a `VERIFIED` off-host copy of **that same stamp**; a `PASSED` restore test of **that same stamp**, made after the backup; no recorded failure; nothing stale (default 120 minutes), future-dated, malformed or mismatched. Anything else refuses before any credential changes. 28 positive/negative tests (`scripts/test-backup-evidence.sh`).
```bash
scripts/rotate-db-password.sh            # dry run: proves the current credential and the evidence, changes nothing
scripts/rotate-db-password.sh --apply
```
It generates the value, sets the role (stdin, never a command line), writes `.env` (mode 600, backed up first), keeps a host-side `DATABASE_URL` in `apps/api/.env` consistent, recreates only the API, then verifies **every database client**: the API container's own driver and connection string, the backup/restore path (`docker exec` socket), and the new credential over the network — and that the old credential is rejected. Any failure restores the database role, `.env` and `apps/api/.env` byte for byte and recreates the API. The old value survives only in the private `.bak.<stamp>` files until you delete them; save the new `POSTGRES_PASSWORD` in the password manager. After rotation a later `docker compose up -d` without `--no-deps` would recreate the postgres container (its environment changed; the volume keeps the data), so always name services.
Rehearsal (`scripts/rehearse-host-procedures.sh`, disposable stack, 26 checks): six refusal cases leave `.env` untouched; the dry run changes nothing; apply succeeds with the secret files at mode 600, the host-side URL updated, other entries preserved, the password never printed; forced failure restores everything byte for byte and the database accepts the previous credential again.
**Rollback boundary:** automatic for a failed rotation. For anything else, restore the verified set into a scratch database first; never over the live one without a decision.

## E. Daily encrypted backup with a verified off-host copy

**Consistency on a live system (nothing is paused).** The API, its workers and the hourly importer keep writing during a backup, and a quiet website does not mean a quiet database. `backup.sh` therefore opens one PostgreSQL snapshot (REPEATABLE READ), runs `pg_dump --snapshot` and the manifest's row counts **inside that same snapshot**, and only then archives the uploads: files are write-once with random names, so the archive holds every file the dumped rows reference, and its file list and checksums are computed in the same container run from the same list the archive is built from (never from a later look at the live volume). A file deleted between dump and archive shows up as a dangling reference and fails the restore test rather than being hidden. Proof: `scripts/test-backup-consistency.sh` runs the real backup and restore test while a writer inserts rows and files throughout (paused 5 s after the snapshot so writes are guaranteed in between): the live database ends with more rows than the manifest, yet the restore matches the snapshot exactly.

**Durable off-host destination — founder input, not yet configured.** No company storage account, key or `rclone` configuration exists on the host, the Mac, or in the repository's GitHub secrets, so none was invented. Needed: an account owned by the company (R2 or B2; both ~$0 at this size: R2 $0.015/GB-month with 10 GB free and free egress, B2 $6.95/TB-month with the first 10 GB free), a bucket-scoped key that can write and read but **not delete**, and a 90-day lifecycle rule (retention lives in the bucket, so the host cannot erase its own history). Nothing is purchased without your approval. Then: install `rclone` for `tefma` only (single binary in `~/.local/bin`, like `age`), `rclone config` as `tefma` (credentials in `~/.config/rclone`, mode 600), `AISE_OFFHOST_REMOTE=<remote>:<bucket>/daily scripts/offhost-sync.sh --selftest` must say "write and read-back work, delete is refused", then add the schedules **without replacing anything** (`crontab -l > ~/crontab.before; (crontab -l 2>/dev/null; cat ops/crontab.tefma.example) | crontab -`; 03:10 Baku = 23:10 UTC, the host is on UTC). Point `/admin/system` at the real status: `host-config.sh backup-status` (section A–C).

**Until the bucket exists (what is and is not proven).** `scripts/mac-verify-backup.sh` proves ONE specific set for a change window: copies it to the Mac, checks both archives against the manifest, records an off-host copy as `VERIFIED` with destination `founder-mac-pull`, restores that exact set in disposable containers, and records `PASSED`/`FAILED` for that stamp. That satisfies the window's gate (`check-backup-evidence.py`) but **is not durable storage**: a laptop that sleeps or is lost is not a backup destination, and `check-health.sh` keeps alerting while the recorded destination is not `bucket`. The daily schedule is not armed with a failing stage; install the cron lines only after the bucket works, or accept a daily alert.

What the daily job does once armed (`scripts/backup-daily.sh`): snapshot-consistent encrypted dump + uploads archive with manifest → each archive copied to the bucket and **read back and hashed against the manifest** → status written, including the set's stamp. Any failed stage records a failure, exits non-zero and stays visible until the next success. Only ciphertext and the manifest leave the host; the private key never does.

## F. Weekly restore test on the founder's Mac (the key stays there)

Where the private key lives (`~/.config/aise-backup/age.key`): download the newest set **from the bucket**, check each archive against the manifest hash, restore into disposable containers (memory-only database, scratch volume), require: no restore errors, **no schema drift (an unverifiable comparison now fails)**, every manifest row count equal, every file byte-identical, every file reference resolving; publish PASSED/FAILED to the production status file over SSH. Install `ops/launchd/az.aise.restore-test.plist` (weekly; a missed run fires on wake). A sleeping Mac delays the test but loses nothing, because the bucket — not the Mac — holds the backups. If the Mac is off for more than 8 days, monitoring alerts.
Rehearsal (stub bucket, throwaway key, real `backup.sh`/`restore-test.sh`): good run PASSED in 4 s; tampered archive, wrong key and missing manifest each FAILED; no test containers left.
**Key custody (founder input).** The age private key exists once, on the Mac. Put a copy in the password manager now (`age.key` is a short text file), plus a printed or encrypted offline copy in a separate place. Losing it makes every backup unreadable. I have not seen it in any password manager and do not assume it is saved.

## G. Monitoring every 15 minutes

`scripts/check-health.sh` (cron above) checks API readiness, backup age (≤ 26 h), recorded job failures, verified off-host copy age (≤ 26 h), restore test passed and ≤ 8 days old, and disk (≥ 15% free); prints short labels only, exits non-zero on any problem and, when `UPTIME_KUMA_PUSH_URL` is set, pushes up/down to a **Push monitor in the Uptime Kuma already on this host** — Kuma alerts on a reported problem and on silence (cron stopped, host down), which no script on the same host can do by itself. **Founder input:** create a Push monitor in Kuma (heartbeat interval 20 min) and attach a notification channel you will actually read (email/Telegram); paste its push URL into the crontab. Logs hold paths and states, never secrets. Tested with a fake API and a fake Kuma: healthy → up; failed off-host → exit 1 and down with a label.

## H. After-change verification (run as `tefma` in the checkout, and once from the Mac over the tailnet)

```bash
scripts/check-host-security.sh                      # on tefma: every line PASS
scripts/check-host-security.sh --probe 100.89.219.95   # from the Mac: 3000 4000 5433 6379 8000 8100 all closed
scripts/check-health.sh                             # all OK
```

## I. Docker volumes (inventory only — nothing deleted)

`tefma`: 14 volumes, all attached to a running or stopped container (AISE `aise_pgdata` 73 MB, `aise_uploads` 108 KB, Redis data; aella; an unrelated Hyperledger "blockland" set). Nothing AISE-owned is unused. **This Mac:** six unused anonymous Postgres 15 volumes from 6 September (~51 MB each, ~310 MB total). Each holds one database `aise` with 1 user, 852 jobs and 851 matches and migrations only up to 14–15 of the current 22: early development/launch-test databases, not production copies, but one user's test data. They were inspected through scratch copies (aggregate counts only). **Left untouched**; say the word and they can be removed. Two empty 4 KB volumes from this session's rehearsal were removed.
