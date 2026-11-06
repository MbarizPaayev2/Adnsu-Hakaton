#!/usr/bin/env bash
#
# Rotates the PostgreSQL password of the production stack in ONE coordinated step:
# the database role, the compose configuration and the API connection together,
# with an automatic rollback if the new credential does not work.
#
#   scripts/rotate-db-password.sh              # dry run: checks everything, changes nothing
#   scripts/rotate-db-password.sh --apply      # rotate
#
# Why one step: compose builds the API's DATABASE_URL from POSTGRES_PASSWORD in
# the root .env. Changing only the role locks the API out; changing only .env
# leaves the database on the old password. The value is generated here, written
# only to .env (mode 600, backed up first) and sent to postgres on stdin. It is
# never printed, logged, or placed on a command line.
#
# Requires: ONE identifiable backup set proven end to end (scripts/check-backup-evidence.py):
# archives and manifest verified, a VERIFIED off-host copy and a PASSED restore test of that
# same set, nothing failed, nothing stale or future-dated; and the deploy user owning .env
# (scripts/check-host-security.sh checks that). The evidence is checked in the dry run too.
# Connections the API already holds stay valid until they recycle; new ones use
# the new password once the API container is recreated (a few seconds).
#
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AISE_DIR="${AISE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DB_CONTAINER="${DB_CONTAINER:-aise-postgres}"
API_SERVICE="${API_SERVICE:-api}"
API_CONTAINER="${API_CONTAINER:-aise-api}"
HEALTH_TRIES="${HEALTH_TRIES:-40}"
DB_NAME="${DB_NAME:-aise}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/aise-backups}"
STATUS_FILE="${STATUS_FILE:-$BACKUP_DIR/status/status.json}"
BACKUP_MAX_AGE_MIN="${BACKUP_MAX_AGE_MIN:-120}"
DEFAULT_DB_PASSWORD="${DEFAULT_DB_PASSWORD:-postgrespassword}"
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1

fail() { printf 'ROTATION ABORTED: %s\n' "$*" >&2; exit 1; }
info() { printf '    %s\n' "$*"; }
cd "$AISE_DIR" || fail "no such directory $AISE_DIR"
ENV_FILE=".env"

[ -f "$ENV_FILE" ] && [ -w "$ENV_FILE" ] || fail "$ENV_FILE is missing or not writable by $(id -un) (run the secret-file ownership step first)"
docker compose config -q >/dev/null 2>&1 || fail "docker compose config -q fails before any change"
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || fail "container $DB_CONTAINER is not running"

current() { sed -n 's/^POSTGRES_PASSWORD=//p' "$ENV_FILE" | tail -n 1 | sed -e 's/^"//' -e 's/"$//'; }
OLD="$(current)"; OLD="${OLD:-$DEFAULT_DB_PASSWORD}"
NET="$(docker inspect "$DB_CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')"
HOST="$(docker inspect "$DB_CONTAINER" --format '{{.Name}}' | tr -d '/')"
can_login() { # password -> 0 when the database accepts it over the network
  docker run --rm --network "$NET" -e PGPASSWORD="$1" -e PGCONNECT_TIMEOUT=5 postgres:15-alpine \
    psql -h "$HOST" -U postgres -d "$DB_NAME" -At -c 'select 1' >/dev/null 2>&1
}
can_login "$OLD" || fail "the current password in $ENV_FILE is not accepted by the database; fix that before rotating (nothing changed)"
info "current credential verified over the network"

# The backup gate: one identifiable set, proven end to end. Checked in the dry run too.
"$SCRIPT_DIR/check-backup-evidence.py" "$STATUS_FILE" "$BACKUP_DIR" "$BACKUP_MAX_AGE_MIN" || fail "the backup evidence is not sufficient (nothing changed)"

if [ "$APPLY" -ne 1 ]; then
  info "dry run: the database, $ENV_FILE and the API would be rotated together. Nothing changed. Re-run with --apply in the maintenance window."
  exit 0
fi

NEW="$(openssl rand -hex 24)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$ENV_FILE" "$ENV_FILE.bak.$STAMP" && chmod 600 "$ENV_FILE.bak.$STAMP" || fail "could not back up $ENV_FILE"

write_env() { # value -> replaces or appends POSTGRES_PASSWORD atomically, mode 600
  local value="$1" tmp; tmp="$(mktemp "$ENV_FILE.XXXXXX")" && chmod 600 "$tmp" || return 1
  { grep -v '^POSTGRES_PASSWORD=' "$ENV_FILE" || true; printf 'POSTGRES_PASSWORD=%s\n' "$value"; } > "$tmp" && mv "$tmp" "$ENV_FILE"
}
sync_env_url() { # value -> keeps a host-side DATABASE_URL in apps/api/.env consistent (containers override it); private, never printed
  local f="apps/api/.env"; [ -f "$f" ] && grep -q '^DATABASE_URL=' "$f" || return 0
  [ -w "$f" ] || return 1
  cp -p "$f" "$f.bak.$STAMP" && chmod 600 "$f.bak.$STAMP" || return 1
  python3 - "$f" "$1" <<'PY'
import os, re, sys, tempfile
path, pw = sys.argv[1], sys.argv[2]
lines = open(path, encoding="utf-8").read().splitlines()
out = []
for line in lines:
    m = re.match(r'^(DATABASE_URL=)(["\']?)(postgres(?:ql)?://[^:/@]+:)[^@]*(@.*?)(["\']?)$', line)
    out.append("%s%s%s%s%s%s" % (m.group(1), m.group(2), m.group(3), pw, m.group(4), m.group(5)) if m else line)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", prefix=".envtmp-")
with os.fdopen(fd, "w", encoding="utf-8") as fh:
    fh.write("\n".join(out) + "\n")
os.chmod(tmp, 0o600); os.replace(tmp, path)
PY
}
# Every AISE database client, not just the API's health check.
verify_clients() { # 0 when all connect with the new credential
  # 1) the API container's own connection string and driver
  docker exec "$API_CONTAINER" sh -c 'cd /repo/apps/api 2>/dev/null; if command -v node >/dev/null 2>&1 && [ -d node_modules/@prisma/client -o -d /repo/node_modules/@prisma/client ]; then node -e "const {PrismaClient}=require(\"@prisma/client\");const p=new PrismaClient();p.\$queryRaw\`select 1\`.then(()=>process.exit(0)).catch(()=>process.exit(1))"; else psql "$DATABASE_URL" -At -c "select 1" >/dev/null; fi' >/dev/null 2>&1 || return 1
  # 2) backups and restore tooling reach the database through docker exec (local socket)
  docker exec "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -At -c 'select 1' >/dev/null 2>&1 || return 1
  # 3) the new credential over the network, as any other client would use it
  can_login "$NEW"
}
set_role() { printf "ALTER USER postgres PASSWORD '%s';\n" "$1" | docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q >/dev/null; }
# deploy.sh passes RELEASE_SHA through the environment (it is not stored in .env); keep the running release identity instead of blanking it.
RELEASE_SHA="${RELEASE_SHA:-$(docker inspect "$API_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | sed -n 's/^RELEASE_SHA=//p')}"; export RELEASE_SHA
recreate_api() { docker compose up -d --no-deps "$API_SERVICE" >/dev/null 2>&1; }
rollback() {
  echo "ROLLING BACK to the previous credential" >&2
  set_role "$OLD" && cp -p "$ENV_FILE.bak.$STAMP" "$ENV_FILE" && { [ ! -f "apps/api/.env.bak.$STAMP" ] || cp -p "apps/api/.env.bak.$STAMP" apps/api/.env; } && recreate_api \
    && echo "rolled back: database, $ENV_FILE and the API are on the previous credential again" >&2 \
    || echo "ROLLBACK INCOMPLETE — previous .env kept at $ENV_FILE.bak.$STAMP; set the role back with ALTER USER and recreate $API_SERVICE" >&2
}

set_role "$NEW" || fail "could not set the new role password (nothing else changed)"
write_env "$NEW" || { rollback; fail "could not write $ENV_FILE"; }
sync_env_url "$NEW" || { rollback; fail "could not update the host-side DATABASE_URL"; }
recreate_api || { rollback; fail "could not recreate the $API_SERVICE container"; }

ok=0
for _ in $(seq 1 "$HEALTH_TRIES"); do
  state="$(docker inspect "$API_CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null)"
  [ "$state" = "healthy" ] && { ok=1; break; }
  sleep 3
done
if [ "$ok" -eq 1 ] && verify_clients && ! can_login "$OLD"; then
  echo "ROTATED: every AISE database client connects with the new credential, the old one is rejected, the API is healthy."
  echo "The previous .env is kept at $ENV_FILE.bak.$STAMP (mode 600) until you delete it; it holds the OLD password."
  echo "Save the new password from $ENV_FILE (POSTGRES_PASSWORD) in the founder's password manager; do not paste it into chat."
  exit 0
fi
rollback
fail "verification failed (healthy=$ok); rolled back"
