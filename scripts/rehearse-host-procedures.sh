#!/usr/bin/env bash
#
# Rehearses the production host procedures on a DISPOSABLE stack (own compose
# project, own network, no published ports, nothing shared with production or
# with a developer's running containers), then removes it:
#
#   scripts/rehearse-host-procedures.sh
#
# Covers scripts/rotate-db-password.sh (evidence gate with negative cases, dry run,
# success with every database client verified, failure with automatic rollback) and scripts/check-host-security.sh
# (default password accepted before, rejected after; secret-file checks).
# Requires docker and the postgres:15-alpine image. Prints PASS/FAIL per step.
#
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"; chmod 700 "$WORK"
export COMPOSE_PROJECT_NAME="aiserehearsal$$"
export AISE_CONTAINER_PREFIX="$COMPOSE_PROJECT_NAME"
export DB_CONTAINER="$COMPOSE_PROJECT_NAME-postgres" API_CONTAINER="$COMPOSE_PROJECT_NAME-api"
FAILS=0
step() { printf '\n== %s\n' "$*"; }
expect() { # description, command...
  local d="$1"; shift
  if "$@" >"$WORK/out.log" 2>&1; then printf 'PASS  %s\n' "$d"; else printf 'FAIL  %s\n' "$d"; sed 's/^/        /' "$WORK/out.log" | tail -8; FAILS=$((FAILS+1)); fi
}
expect_fail() { local d="$1"; shift; if "$@" >"$WORK/out.log" 2>&1; then printf 'FAIL  %s (should have failed)\n' "$d"; FAILS=$((FAILS+1)); else printf 'PASS  %s\n' "$d"; fi; }
down() { (cd "$WORK" && docker compose down -v --remove-orphans >/dev/null 2>&1); rm -rf "$WORK"; }
trap down EXIT

mkdir -p "$WORK/apps/api"
cat > "$WORK/docker-compose.yml" <<YML
services:
  postgres:
    image: postgres:15-alpine
    container_name: $DB_CONTAINER
    tmpfs: [/var/lib/postgresql/data]
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: "\${POSTGRES_PASSWORD:-postgrespassword}"
      POSTGRES_DB: aise
    healthcheck: { test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U postgres -d aise"], interval: 2s, timeout: 3s, retries: 30 }
  api:
    image: postgres:15-alpine
    container_name: $API_CONTAINER
    depends_on: { postgres: { condition: service_healthy } }
    env_file: [./apps/api/.env]
    environment:
      DATABASE_URL: "postgresql://postgres:\${POSTGRES_PASSWORD:-postgrespassword}@postgres:5432/aise"
      PAYMENTS_ENABLED: "false"
      APP_ENV: rehearsal
      RELEASE_SHA: deadbeef
    command: ["sleep", "3600"]
    healthcheck: { test: ["CMD-SHELL", "\${API_HEALTH_CMD:-psql \\"\$\$DATABASE_URL\\" -c 'select 1'}"], interval: 2s, timeout: 4s, retries: 3 }
YML
printf 'ADMIN_MFA_ENCRYPTION_KEY=%s\nDATABASE_URL=postgresql://postgres:postgrespassword@localhost:5433/aise?schema=public\n' "$(openssl rand -base64 32)" > "$WORK/apps/api/.env"
: > "$WORK/.env"; chmod 600 "$WORK/.env" "$WORK/apps/api/.env"
. "$HERE/backup-fixture.sh"
export AISE_DIR="$WORK" BACKUP_DIR="$WORK/backups" STATUS_FILE="$WORK/backups/status.json" HEALTH_TRIES=12
cd "$WORK"
step "start the disposable stack (default password, like production today)"
expect "stack starts healthy" docker compose up -d --wait --wait-timeout 90

step "before: the verifier flags the default password"
expect_fail "check-host-security fails while the default password works" "$HERE/check-host-security.sh"
grep -E 'default database password|secret|mode 600' "$WORK/out.log" | sed 's/^/        /'

step "rotation refuses insufficient backup evidence (nothing changes), and a dry run changes nothing"
expect_fail "apply refused: no backup evidence at all" "$HERE/rotate-db-password.sh" --apply
grep -q "no status file" "$WORK/out.log" && echo "PASS  reason given: no status file" || { echo "FAIL  wrong reason"; FAILS=$((FAILS+1)); }
STAMP="$(make_set "$WORK/backups" 10)"
edit "$WORK/backups/status.json" "d['lastRestoreTestResult']='FAILED'"
expect_fail "apply refused: the restore test of the set FAILED" "$HERE/rotate-db-password.sh" --apply
edit "$WORK/backups/status.json" "d['lastRestoreTestResult']='PASSED'; d['lastRestoreTestStamp']='20200101T000000Z'"
expect_fail "apply refused: the restore test is of a different set" "$HERE/rotate-db-password.sh" --apply
edit "$WORK/backups/status.json" "d['lastRestoreTestStamp']=d['lastBackupStamp']; d['lastOffhostResult']='FAILED'"
expect_fail "apply refused: the off-host copy is not verified" "$HERE/rotate-db-password.sh" --apply
edit "$WORK/backups/status.json" "d['lastOffhostResult']='VERIFIED'; d['lastBackupAt']='2999-01-01T00:00:00Z'"
expect_fail "apply refused: future-dated evidence" "$HERE/rotate-db-password.sh" --apply
printf 'x' >> "$WORK/backups/$STAMP-uploads.tar.gz.age"
edit "$WORK/backups/status.json" "import datetime; d['lastBackupAt']=datetime.datetime.strptime(d['lastBackupStamp'],'%Y%m%dT%H%M%SZ').strftime('%Y-%m-%dT%H:%M:%SZ')"
expect_fail "apply refused: an archive no longer matches its manifest" "$HERE/rotate-db-password.sh" --apply
[ ! -s "$WORK/.env" ] && echo "PASS  .env untouched after every refusal" || { echo "FAIL  .env changed"; FAILS=$((FAILS+1)); }
expect_ok() { "$@" >"$WORK/out.log" 2>&1 && printf 'PASS  %s\n' "$DESC" || { printf 'FAIL  %s\n' "$DESC"; sed 's/^/        /' "$WORK/out.log" | tail -6; FAILS=$((FAILS+1)); }; }
rm -rf "$WORK/backups"; STAMP="$(make_set "$WORK/backups" 10)"
DESC="dry run with complete evidence succeeds and changes nothing" expect_ok "$HERE/rotate-db-password.sh"
[ ! -s "$WORK/.env" ] && echo "PASS  .env untouched by the dry run" || { echo "FAIL  .env changed by dry run"; FAILS=$((FAILS+1)); }

step "rotation succeeds with complete, consistent evidence; every client connects afterwards"
DESC="rotate --apply" expect_ok "$HERE/rotate-db-password.sh" --apply
tail -4 "$WORK/out.log" | sed 's/^/        /'
[ "$(stat -f '%Lp' .env 2>/dev/null || stat -c '%a' .env)" = "600" ] && echo "PASS  .env is mode 600" || { echo "FAIL  .env mode"; FAILS=$((FAILS+1)); }
[ "$(stat -f '%Lp' apps/api/.env 2>/dev/null || stat -c '%a' apps/api/.env)" = "600" ] && echo "PASS  apps/api/.env is mode 600" || { echo "FAIL  apps/api/.env mode"; FAILS=$((FAILS+1)); }
grep -q '^POSTGRES_PASSWORD=' .env && echo "PASS  .env carries the new POSTGRES_PASSWORD (value not shown)" || { echo "FAIL  no password in .env"; FAILS=$((FAILS+1)); }
NEWPW="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env)"
grep -q 'postgrespassword' apps/api/.env && { echo "FAIL  host-side DATABASE_URL still holds the old password"; FAILS=$((FAILS+1)); } || echo "PASS  host-side DATABASE_URL no longer holds the old password"
grep -q "$NEWPW" apps/api/.env && echo "PASS  host-side DATABASE_URL carries the new credential" || { echo "FAIL  host-side DATABASE_URL not updated"; FAILS=$((FAILS+1)); }
grep -q '^ADMIN_MFA_ENCRYPTION_KEY=' apps/api/.env && echo "PASS  other apps/api/.env entries preserved (MFA key line intact)" || { echo "FAIL  MFA key line lost"; FAILS=$((FAILS+1)); }
ls apps/api/.env.bak.* >/dev/null 2>&1 && [ "$(stat -f '%Lp' apps/api/.env.bak.* 2>/dev/null | sort -u || stat -c '%a' apps/api/.env.bak.* | sort -u)" = "600" ] && echo "PASS  credential backups are private (mode 600)" || { echo "FAIL  backup files not private"; FAILS=$((FAILS+1)); }
expect "check-host-security now passes" "$HERE/check-host-security.sh"
grep -E 'PASS|FAIL' "$WORK/out.log" | sed 's/^/        /'
if grep -rqF -- "$NEWPW" "$WORK/out.log"; then echo "FAIL  the password appeared in script output"; FAILS=$((FAILS+1)); else echo "PASS  the password never appeared in script output"; fi
docker compose exec -T api sh -c 'psql "$DATABASE_URL" -At -c "select 1"' >/dev/null 2>&1 && echo "PASS  the API container's own connection string works" || { echo "FAIL  API client cannot connect"; FAILS=$((FAILS+1)); }

step "failure path: the API cannot become healthy with the new credential -> automatic rollback"
before="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env)"
rm -rf "$WORK/backups"; STAMP="$(make_set "$WORK/backups" 5)"
beforeurl="$(cat apps/api/.env | sha256sum 2>/dev/null || shasum -a 256 apps/api/.env)"
API_HEALTH_CMD=false HEALTH_TRIES=3 expect_fail "rotation aborts when the API never becomes healthy" "$HERE/rotate-db-password.sh" --apply
after="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env)"
[ "$before" = "$after" ] && echo "PASS  .env restored to the previous credential"
afterurl="$(cat apps/api/.env | sha256sum 2>/dev/null || shasum -a 256 apps/api/.env)"
[ "$beforeurl" = "$afterurl" ] && echo "PASS  apps/api/.env restored byte for byte" || { echo "FAIL  apps/api/.env not restored"; FAILS=$((FAILS+1)); } || { echo "FAIL  .env not restored"; FAILS=$((FAILS+1)); }
docker run --rm --network "$(docker inspect "$DB_CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')" -e PGPASSWORD="$before" postgres:15-alpine psql -h "$DB_CONTAINER" -U postgres -d aise -At -c 'select 1' >/dev/null 2>&1 \
  && echo "PASS  database accepts the previous credential after rollback" || { echo "FAIL  database does not accept the previous credential"; FAILS=$((FAILS+1)); }

echo; [ "$FAILS" -eq 0 ] && echo "REHEARSAL PASSED" || echo "REHEARSAL: $FAILS step(s) FAILED"
exit $((FAILS>0))
