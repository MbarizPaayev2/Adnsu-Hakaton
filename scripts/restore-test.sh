#!/usr/bin/env bash
#
# Proves a backup can actually be restored, in an isolated throwaway stack.
#
#   ./scripts/restore-test.sh <db-archive> <uploads-archive>
#
# This is the part people skip. `pg_dump` exiting 0 says the dump ran; it says
# nothing about whether the dump restores, whether the schema matches what the
# code expects, or whether the files the restored rows point at exist.
#
# It runs against a SEPARATE postgres container (data in memory only) and a
# SEPARATE files volume, both named *-restoretest and destroyed afterwards.
# It never touches the running stack, its volumes, or production data.
#
# Checks performed:
#   1. the dump decrypts and gunzips
#   2. it restores into an empty database without errors
#   3. Prisma considers the restored schema up to date (no drift)
#   4. row counts match the manifest taken at backup time
#   5. every file referenced by restored rows exists in the restored volume,
#      and every restored file matches its checksum from backup time
#
# Prints the elapsed time: a measured recovery time, not an estimate.
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

STARTED_AT=$SECONDS
DB_ARCHIVE="${1:?usage: restore-test.sh <db-archive> <uploads-archive>}"
FILES_ARCHIVE="${2:?usage: restore-test.sh <db-archive> <uploads-archive>}"

# Unique per run. Fixed names risk destroying a resource someone else created
# (or a concurrent run's), and `cleanup` deletes whatever it is pointed at.
RUN_ID="$$-$(date +%s)"
TEST_PG="aise-restoretest-$RUN_ID"
TEST_VOL="aise-restoretest-$RUN_ID"
# Port 0 lets Docker pick a free port, so concurrent runs cannot collide.
TEST_PORT="${TEST_PORT:-0}"
PG_USER=postgres
PG_PASS=restoretest
PG_DB=aise
# The schema the restored database must match. Defaults to this checkout's;
# a backup taken on an older release is checked against that release's
# schema.prisma (e.g. SCHEMA_FILE=/path/to/<old-sha>/schema.prisma).
SCHEMA_FILE="${SCHEMA_FILE:-apps/api/prisma/schema.prisma}"

# Row counts recorded for the restore test. Counts only the tables that exist
# in this database's schema, so a backup taken on an older release (before a
# table existed) still records every count it can. Same query in
# scripts/backup.sh and scripts/restore-test.sh.
COUNT_TABLES="ARRAY['User','Profile','Resume','Match','Application','ApplicationFile','ApplicationAnswer','ExternalApplication','Subscription','Job','Company','Vacancy','AdminUser','AdminAuditLog','BillingWebhookEvent']"
COUNT_SQL="$(cat <<SQL
SELECT table_name,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = ANY ($COUNT_TABLES)
ORDER BY array_position($COUNT_TABLES, table_name::text);
SQL
)"

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
fail() { printf '\n\033[31mRESTORE TEST FAILED: %s\033[0m\n' "$*" >&2; cleanup; exit 1; }

cleanup() {
  # -v: the postgres image declares a data VOLUME; without it every run left a
  # decrypted copy of the restored database behind as an anonymous volume.
  docker rm -f -v "$TEST_PG" >/dev/null 2>&1 || true
  docker volume rm "$TEST_VOL" >/dev/null 2>&1 || true
  rm -f /tmp/aise-restored-counts.txt /tmp/aise-restored-refs.txt /tmp/aise-restored-sums.txt /tmp/aise-manifest-sums.txt
}
trap cleanup EXIT

decrypt() {
  case "$1" in
    *.age) age -d -i "${AISE_BACKUP_AGE_IDENTITY:?set AISE_BACKUP_AGE_IDENTITY}" "$1" ;;
    *.gpg) gpg --quiet --decrypt "$1" ;;
    *)     cat "$1" ;;
  esac
}

[ -f "$DB_ARCHIVE" ]    || fail "no such file: $DB_ARCHIVE"
[ -f "$FILES_ARCHIVE" ] || fail "no such file: $FILES_ARCHIVE"

cd "$(dirname "$0")/.."
cleanup   # in case a previous run died before its trap

# ---------------------------------------------------- 1. archive integrity --
log "1/5 Checking archives decrypt and decompress"
decrypt "$DB_ARCHIVE"    | gzip -t - || fail "database archive is corrupt"
decrypt "$FILES_ARCHIVE" | gzip -t - || fail "uploads archive is corrupt"
info "both archives are readable"

# ------------------------------------------------------ 2. restore the db ---
log "2/5 Restoring into an isolated database"
# The restored (decrypted) data lives only in memory: nothing is written to a
# Docker volume, so a killed run cannot leave a copy on disk.
docker run -d --name "$TEST_PG" --tmpfs /var/lib/postgresql/data:rw \
  -e POSTGRES_USER="$PG_USER" -e POSTGRES_PASSWORD="$PG_PASS" -e POSTGRES_DB="$PG_DB" \
  -p "127.0.0.1:$TEST_PORT:5432" postgres:15-alpine >/dev/null \
  || fail "could not start the test postgres container"

# Docker assigned the port; read it back before anything tries to connect.
TEST_PORT="$(docker port "$TEST_PG" 5432/tcp | head -1 | sed 's/.*://')"
[ -n "$TEST_PORT" ] || fail "could not determine the test container's mapped port"
info "test postgres on 127.0.0.1:$TEST_PORT"

# The image first runs a temporary server for initialisation that listens on
# the Unix socket only, then restarts. Probing over TCP (only the final server
# listens there) and requiring two answers in a row avoids racing that restart.
READY=0
for _ in $(seq 1 120); do
  if docker exec "$TEST_PG" pg_isready -h 127.0.0.1 -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    READY=$((READY+1)); [ "$READY" -ge 2 ] && break
  else
    READY=0
  fi
  sleep 1
done
[ "$READY" -ge 2 ] || fail "test postgres never became ready"

# ON_ERROR_STOP is what turns "restored with errors" into a failure.
if ! decrypt "$DB_ARCHIVE" | gunzip \
     | docker exec -i "$TEST_PG" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -q; then
  fail "psql reported errors while restoring the dump"
fi
info "dump restored with no errors"

# --------------------------------------------- 3. schema matches the code ---
[ -f "$SCHEMA_FILE" ] || fail "no such schema file: $SCHEMA_FILE"
log "3/5 Checking the restored schema against $SCHEMA_FILE"
# `migrate diff --exit-code` exits 2 when there is a difference, which is
# exactly the drift we want to catch: a backup that restores but no longer
# matches the application's expected schema is not a usable backup.
if DATABASE_URL="postgresql://$PG_USER:$PG_PASS@127.0.0.1:$TEST_PORT/$PG_DB?schema=public" \
   npx prisma migrate diff \
     --from-url "postgresql://$PG_USER:$PG_PASS@127.0.0.1:$TEST_PORT/$PG_DB?schema=public" \
     --to-schema-datamodel "$SCHEMA_FILE" \
     --exit-code >/dev/null 2>&1; then
  info "no drift: restored schema matches $SCHEMA_FILE"
else
  case $? in
    2) fail "restored schema does NOT match $SCHEMA_FILE — the backup predates a migration, or a migration was applied outside the repo" ;;
    # Missing comparison evidence is a failure, not a shrug: a restore whose schema
    # could not be compared is not proven usable.
    *) fail "could not run prisma migrate diff, so schema drift is unverified (is npx/prisma available here?)" ;;
  esac
fi

# ------------------------------------------------------- 4. row counts ------
log "4/5 Comparing row counts with the backup manifest"
MANIFEST="$(dirname "$DB_ARCHIVE")/$(basename "$DB_ARCHIVE" | sed 's/-db\.sql\.gz.*//')-manifest.txt"
docker exec "$TEST_PG" psql -U "$PG_USER" -d "$PG_DB" -At -F' ' -c "$COUNT_SQL" > /tmp/aise-restored-counts.txt \
  || fail "could not count rows in the restored database"
if [ -f "$MANIFEST" ]; then
  info "manifest: $MANIFEST"
  COMPARED=0
  while read -r table expected; do
    [ -z "${expected:-}" ] && continue
    actual=$(awk -v t="$table" '$1==t {print $2}' /tmp/aise-restored-counts.txt)
    if [ "${actual:-}" = "$expected" ]; then
      info "  $table: $actual ✓"; COMPARED=$((COMPARED+1))
    else
      fail "$table: manifest says $expected, restored has ${actual:-none}"
    fi
  done < <(sed -n '/row counts at backup time/,/^$/p' "$MANIFEST" | grep -E '^[A-Z]' || true)
  # A manifest without counts used to pass this step by comparing nothing.
  [ "$COMPARED" -gt 0 ] || fail "the manifest records no row counts — nothing to compare, so this is not a passing restore test"
else
  # Not a soft warning: the manifest is the only record of what the source
  # looked like, so without it there is nothing to compare against and the
  # run cannot claim the restore is complete.
  fail "no manifest beside the archive ($MANIFEST) — row counts cannot be verified, so this is not a passing restore test"
fi

# ------------------------------- 5. do restored rows point at real files? ---
log "5/5 Checking restored files: references resolve, checksums match"
docker volume create "$TEST_VOL" >/dev/null
decrypt "$FILES_ARCHIVE" | docker run --rm -i -v "$TEST_VOL":/data alpine \
  tar -xzf - -C /data || fail "could not extract the uploads archive"

# Every file-bearing column, not a sample — but only the ones this schema
# has: a backup of an older release lacks columns added later.
FILE_COLUMNS="ARRAY['Resume.fileUrl','Profile.idDocumentUrl','ApplicationFile.fileUrl','ApplicationAnswer.fileUrl','ExternalApplication.cvSnapshotUrl','ExternalApplication.idDocumentSnapshotUrl','ExternalApplication.reviewScreenshotUrl']"
REF_SQL="$(docker exec "$TEST_PG" psql -U "$PG_USER" -d "$PG_DB" -At -c "
  SELECT string_agg(format('SELECT %I FROM public.%I WHERE %I IS NOT NULL', column_name, table_name, column_name), ' UNION ')
  FROM information_schema.columns
  WHERE table_schema = 'public' AND (table_name || '.' || column_name) = ANY ($FILE_COLUMNS);")" \
  || fail "could not list the file columns of the restored database"
[ -n "$REF_SQL" ] || fail "the restored database has none of the expected file columns — cannot claim consistency"
info "file columns checked: $(grep -o 'SELECT ' <<<"$REF_SQL" | wc -l | tr -d ' ')"
docker exec "$TEST_PG" psql -U "$PG_USER" -d "$PG_DB" -At -c "$REF_SQL;" > /tmp/aise-restored-refs.txt \
  || fail "could not read file references from the restored database — cannot claim consistency"

# One listing of the restored volume instead of a container per file.
docker run --rm -v "$TEST_VOL":/data:ro alpine sh -c 'cd /data && find . -type f -exec sha256sum {} +' \
  | sed 's#  \./#  #' | sort > /tmp/aise-restored-sums.txt \
  || fail "could not checksum the restored volume"

TOTAL=0; MISSING=0
while read -r url; do
  [ -z "$url" ] && continue
  TOTAL=$((TOTAL+1))
  name="${url##*/}"
  awk -v n="$name" '$2==n {found=1} END {exit !found}' /tmp/aise-restored-sums.txt \
    || { MISSING=$((MISSING+1)); [ "$MISSING" -le 5 ] && info "  MISSING: $name"; }
done < /tmp/aise-restored-refs.txt

# Every file recorded at backup time must come back byte-identical.
sed -n '/^file sha256/,$p' "$MANIFEST" | tail -n +2 | sed 's#  \./#  #' | sort > /tmp/aise-manifest-sums.txt
EXPECTED_FILES=$(wc -l < /tmp/aise-manifest-sums.txt)
if [ "$EXPECTED_FILES" -eq 0 ]; then
  fail "the manifest has no file checksums (backup predates checksum recording) — re-run scripts/backup.sh"
fi
if ! diff -q /tmp/aise-manifest-sums.txt /tmp/aise-restored-sums.txt >/dev/null; then
  BAD=$(diff /tmp/aise-manifest-sums.txt /tmp/aise-restored-sums.txt | grep -c '^[<>]' || true)
  fail "$BAD restored file checksum line(s) differ from the backup manifest"
fi
info "all $EXPECTED_FILES restored files match their backup checksums ✓"

if [ "$TOTAL" -eq 0 ]; then
  info "no file references in the restored data (nothing to check)"
elif [ "$MISSING" -eq 0 ]; then
  info "all $TOTAL file references resolve ✓"
else
  fail "$MISSING of $TOTAL file references are missing from the uploads archive — database and files are not consistent with each other"
fi

log "RESTORE TEST PASSED in $((SECONDS - STARTED_AT))s (measured recovery time for this backup)"

# Record the result for the admin panel (see scripts/backup.sh).
STATUS_FILE="${STATUS_FILE:-/var/backups/aise/status/status.json}"
if [ -d "$(dirname "$STATUS_FILE")" ]; then
  "$SCRIPT_DIR/status-update.sh" --file "$STATUS_FILE" \
    lastRestoreTestAt="$(date -u +%Y-%m-%dT%H:%M:%SZ)" lastRestoreTestResult=PASSED lastRestoreTestSeconds="$((SECONDS - STARTED_AT))" \
    lastRestoreTestStamp="$(basename "$DB_ARCHIVE" | sed 's/-db\.sql\.gz.*//')"
fi
echo "This backup pair restores cleanly, matches the current schema, and its"
echo "database and file halves are consistent with each other."
