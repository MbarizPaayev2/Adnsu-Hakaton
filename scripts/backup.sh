#!/usr/bin/env bash
#
# Backup for the AISE stack: PostgreSQL plus the uploaded-files volume.
#
#   ./scripts/backup.sh [destination-dir]
#
# Both halves are taken together and are only useful together: a database dump
# on its own restores rows whose files are gone (Resume.fileUrl,
# Profile.idDocumentUrl, ApplicationFile.fileUrl all point into the uploads
# volume), and a file archive on its own has nothing referencing it.
#
# Encryption is required, not optional: these archives contain CVs, contact
# details, dates of birth and identity-document photos. The script refuses to
# run without a recipient, rather than quietly writing plaintext PII.
#
# Consistency on a live system. Nothing is paused: the API, its workers and the hourly
# importer keep writing. The dump and the row counts in the manifest are taken from ONE
# exported PostgreSQL snapshot (REPEATABLE READ), so they describe exactly the same instant.
# Uploaded files are write-once with random names, so the archive is taken AFTER the dump
# (it holds every file the dumped rows reference), and its file list and checksums are
# computed in the same container run from the same list the archive is built from — never
# from a later look at the live volume. A file deleted between dump and archive shows up as a
# dangling reference in the restore test, which then fails the set rather than hiding it.
#
# What this script does NOT do, on purpose:
#   - copy anything off the host (that is the caller's job; see docs)
#   - delete old backups anywhere but the local destination
#   - claim success from a zero exit code alone. Every archive is verified
#     after writing, and the run fails if verification fails.
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

DEST="${1:-/var/backups/aise}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
COMPOSE="${COMPOSE:-docker compose}"
PG_CONTAINER="${PG_CONTAINER:-aise-postgres}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-aise}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-aise_uploads}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

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

# age (preferred) or gpg. AISE_BACKUP_AGE_RECIPIENT / AISE_BACKUP_GPG_RECIPIENT
# come from the environment; no key material is stored in this repo.
AGE_RECIPIENT="${AISE_BACKUP_AGE_RECIPIENT:-}"
GPG_RECIPIENT="${AISE_BACKUP_GPG_RECIPIENT:-}"

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
fail() { printf '\n\033[31mBACKUP FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."

# ------------------------------------------------------------- preflight ----
command -v docker >/dev/null || fail "docker is not installed"
docker inspect "$PG_CONTAINER" >/dev/null 2>&1 \
  || fail "container '$PG_CONTAINER' is not running — start the stack first"
docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1 \
  || fail "volume '$UPLOADS_VOLUME' does not exist. If this host predates the uploads volume, uploaded files were never persisted — see docs/production-readiness.md before continuing"

if [ -n "$AGE_RECIPIENT" ]; then
  command -v age >/dev/null || fail "AISE_BACKUP_AGE_RECIPIENT is set but 'age' is not installed"
  ENCRYPT() { age -r "$AGE_RECIPIENT" -o "$1.age"; }
  DECRYPT_HINT="age -d -i <key> $STAMP-*.age"
  EXT=".age"
elif [ -n "$GPG_RECIPIENT" ]; then
  command -v gpg >/dev/null || fail "AISE_BACKUP_GPG_RECIPIENT is set but 'gpg' is not installed"
  ENCRYPT() { gpg --batch --yes --encrypt --recipient "$GPG_RECIPIENT" --output "$1.gpg"; }
  DECRYPT_HINT="gpg --decrypt $STAMP-*.gpg"
  EXT=".gpg"
elif [ "${AISE_BACKUP_ALLOW_PLAINTEXT:-}" = "i-understand-this-is-not-for-production" ]; then
  # Escape hatch so the pipeline itself can be exercised on a machine without
  # age or gpg installed (see scripts/restore-test.sh). The value is
  # deliberately a sentence rather than "1" so it cannot be set by accident,
  # and it shouts on every run. Never set this on the production host: the
  # archives contain CVs, dates of birth and identity-document photos.
  printf '\n\033[31m!! WRITING UNENCRYPTED BACKUPS — testing only, never on production !!\033[0m\n'
  ENCRYPT() { cat > "$1"; }
  DECRYPT_HINT="(unencrypted)"
  EXT=""
else
  fail "refusing to write unencrypted backups. Set AISE_BACKUP_AGE_RECIPIENT (preferred) or AISE_BACKUP_GPG_RECIPIENT. These archives contain CVs and identity-document photos."
fi

mkdir -p "$DEST"
# Backups are readable only by their owner.
chmod 700 "$DEST"

DB_FILE="$DEST/$STAMP-db.sql.gz$EXT"
FILES_FILE="$DEST/$STAMP-uploads.tar.gz$EXT"
MANIFEST="$DEST/$STAMP-manifest.txt"

log "Backing up to $DEST"
info "database:  $PG_DB from $PG_CONTAINER"
info "files:     volume $UPLOADS_VOLUME"

# Integrity of each compressed stream is checked as it is written, before
# encryption. That needs no private key, so the key never has to live on this
# host (age and gpg are authenticated: a ciphertext that decrypts is the
# plaintext that was checked). Decryption itself is proven by
# scripts/restore-test.sh, run where the key is kept.
CHECK_DIR="$(mktemp -d)"
CHECK_TIMEOUT="${AISE_BACKUP_CHECK_TIMEOUT_SECONDS:-60}"   # bound on waiting for a stream's checker
BACKUP_COMPLETE=0
# Runs on every exit, success or failure (and on SIGTERM/SIGINT): ends the snapshot session, stops any checker
# that is still alive, removes this run's partial archives when it did not finish, and deletes the scratch dir.
cleanup() {
  local rc=$? p f
  exec 3>&- || true                        # closing the writer ends the snapshot transaction: its psql reads EOF and exits
  for f in "$CHECK_DIR"/*.pid; do
    [ -f "$f" ] || continue
    p="$(cat "$f" 2>/dev/null)"; [ -n "$p" ] || continue
    pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true
  done
  if [ -n "${SNAP_PID:-}" ] && kill -0 "$SNAP_PID" 2>/dev/null; then
    sleep 1; kill "$SNAP_PID" 2>/dev/null || true     # EOF normally ended it; this is only the backstop
  fi
  if [ "$BACKUP_COMPLETE" != 1 ]; then
    rm -f "${DB_FILE:-}" "${FILES_FILE:-}" "${MANIFEST:-}"   # a set without its manifest is unusable and must not linger
  fi
  rm -rf "$CHECK_DIR"
  exit "$rc"
}
trap cleanup EXIT
# Each call (a retry of the uploads archive included) starts from a clean FIFO and no stale result (before, a retry
# only worked because errexit is off inside the retry loop's && list, which hid mkfifo's "File exists", and a stale
# "ok" from the failed attempt could be read as the new attempt's verdict). The checker
# always reports - ok or bad - so a corrupt stream is detected at once rather than at the timeout, and the result
# is renamed into place so a reader can never see it half-written.
stream_check() { # NAME: tee the stream into gzip -t; the verdict lands in $CHECK_DIR/NAME.result
  rm -f "$CHECK_DIR/$1.fifo" "$CHECK_DIR/$1.result" "$CHECK_DIR/$1.result.tmp" "$CHECK_DIR/$1.pid"
  mkfifo "$CHECK_DIR/$1.fifo"
  # stdout goes to /dev/null: the checker would otherwise inherit this stage's stdout (the pipe into the
  # encryption stage) and keep its write end open, so the encryption stage would never see EOF while the checker
  # lives and the bounded wait in stream_ok could never be reached.
  (
    if gzip -t < "$CHECK_DIR/$1.fifo"; then verdict=ok; else verdict=bad; fi
    echo "$verdict" > "$CHECK_DIR/$1.result.tmp" && mv "$CHECK_DIR/$1.result.tmp" "$CHECK_DIR/$1.result"
  ) > /dev/null &
  echo $! > "$CHECK_DIR/$1.pid"
  tee "$CHECK_DIR/$1.fifo"
}
# Waits (bounded) for THIS stream's checker only: a bare `wait` would also wait for the long-lived snapshot
# session below. Returns success only on an `ok` verdict; on timeout it stops the checker and fails.
stream_ok() { # NAME
  local name="$1" deadline=$((SECONDS + CHECK_TIMEOUT)) p
  while [ ! -f "$CHECK_DIR/$name.result" ] && [ "$SECONDS" -lt "$deadline" ]; do sleep 0.1; done
  if [ ! -f "$CHECK_DIR/$name.result" ]; then
    p="$(cat "$CHECK_DIR/$name.pid" 2>/dev/null || true)"
    if [ -n "$p" ]; then pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; fi
    return 1
  fi
  [ "$(cat "$CHECK_DIR/$name.result")" = ok ]
}

# ------------------------------------------------- one snapshot for dump + counts ----
# A psql session holds a REPEATABLE READ transaction open (commands arrive through a FIFO), exports its
# snapshot, and later runs the row-count query inside the same transaction. pg_dump --snapshot reads
# that same instant.
SNAP_DIR="$CHECK_DIR/snap"; mkdir -p "$SNAP_DIR"; mkfifo "$SNAP_DIR/in"
docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At -F' ' -v ON_ERROR_STOP=1 < "$SNAP_DIR/in" > "$SNAP_DIR/out" 2> "$SNAP_DIR/err" &
SNAP_PID=$!
exec 3> "$SNAP_DIR/in"
printf 'BEGIN ISOLATION LEVEL REPEATABLE READ;\nSELECT pg_export_snapshot();\n' >&3
SNAPSHOT_ID=""
for _ in $(seq 1 100); do
  SNAPSHOT_ID="$(grep -E '^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$' "$SNAP_DIR/out" 2>/dev/null | head -1 || true)"
  [ -n "$SNAPSHOT_ID" ] && break
  kill -0 "$SNAP_PID" 2>/dev/null || break
  sleep 0.1
done
[ -n "$SNAPSHOT_ID" ] || fail "could not open a consistent database snapshot"
info "database snapshot $SNAPSHOT_ID held open for the dump and the row counts"
[ -z "${AISE_BACKUP_TEST_DELAY_AFTER_SNAPSHOT:-}" ] || sleep "$AISE_BACKUP_TEST_DELAY_AFTER_SNAPSHOT"   # rehearsal only: lets a writer run between snapshot and dump

# -------------------------------------------------------------- database ----
# --clean --if-exists so a restore into a populated database replaces objects
# instead of erroring halfway through.
log "Dumping PostgreSQL"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" --clean --if-exists --snapshot="$SNAPSHOT_ID" \
  | gzip -9 \
  | stream_check db \
  | ENCRYPT "${DB_FILE%$EXT}" \
  || fail "pg_dump pipeline failed"
stream_ok db || fail "database archive failed its integrity check while being written"
[ -s "$DB_FILE" ] || fail "database archive is empty: $DB_FILE"
info "wrote $(du -h "$DB_FILE" | cut -f1) $DB_FILE"

# Row counts from the SAME snapshot. A failed or empty result fails the backup: without
# counts the restore test has nothing to compare against.
printf '%s\nSELECT '"'"'__COUNTS_DONE__'"'"';\nCOMMIT;\n' "$COUNT_SQL" >&3
exec 3>&-
wait "$SNAP_PID" || fail "the snapshot session failed: $(head -c 200 "$SNAP_DIR/err")"
COUNTS="$(sed -n '/^[0-9A-Fa-f]*-[0-9A-Fa-f]*-[0-9]*$/,/^__COUNTS_DONE__$/p' "$SNAP_DIR/out" | sed '1d;$d')"
[ -n "$COUNTS" ] || fail "row count query returned no tables"

# ----------------------------------------------------------------- files ----
# Read the volume through a throwaway container so this works no matter where Docker actually stores
# it. The file list and checksums come from the same run, from the same list the archive is built from.
log "Archiving uploads volume"
UP_DIR="$CHECK_DIR/up"; mkdir -p "$UP_DIR"
attempt=0
while :; do
  attempt=$((attempt+1)); rm -f "$UP_DIR"/*
  docker run --rm -v "$UPLOADS_VOLUME":/data:ro -v "$UP_DIR":/out alpine sh -c '
    cd /data && find . -type f | sort > /out/list &&
    { [ -s /out/list ] && xargs sha256sum < /out/list > /out/sums || : > /out/sums; } &&
    chmod 644 /out/list /out/sums &&
    if [ -s /out/list ]; then tar -czf - -T /out/list; else tar -czf - --files-from /dev/null; fi' \
    | stream_check uploads \
    | ENCRYPT "${FILES_FILE%$EXT}" && stream_ok uploads && break
  [ "$attempt" -lt 3 ] || fail "uploads archive pipeline failed after $attempt attempts (a file may keep vanishing)"
  info "uploads archive attempt $attempt failed (a file changed while being read?); retrying"
  rm -f "${FILES_FILE%$EXT}" "$FILES_FILE"
done
[ -s "$FILES_FILE" ] || fail "uploads archive is empty: $FILES_FILE"
info "wrote $(du -h "$FILES_FILE" | cut -f1) $FILES_FILE ($(wc -l < "$UP_DIR/list" | tr -d ' ') file(s))"

# ---------------------------------------------------------- verification ----
# A backup that has not been read back is not a backup. Both streams were
# checked while being written (above). When a decryption key IS available
# here, the written files are also decrypted and checked; otherwise that
# proof comes from scripts/restore-test.sh. Neither proves a full restore.
log "Verifying archives"
info "database and uploads streams passed gzip integrity checks before encryption"

verify() {
  local f="$1" kind="$2"
  # Decided before the pipeline: a `return` inside it would only leave its subshell.
  if [[ "$f" == *.age && -z "${AISE_BACKUP_AGE_IDENTITY:-}" ]]; then
    info "$kind: no private key on this host (expected); decryption is proven by restore-test.sh"
    return 0
  fi
  case "$f" in
    *.age) age -d -i "$AISE_BACKUP_AGE_IDENTITY" "$f" ;;
    *.gpg) gpg --quiet --decrypt "$f" ;;
    *)     cat "$f" ;;
  esac | gzip -t - 2>/dev/null || fail "$kind archive failed verification (decrypt+gunzip): $f"
  info "$kind archive decrypted and verified"
}

verify "$DB_FILE"    "database"
verify "$FILES_FILE" "uploads"

# Row counts recorded now give a restore something to be checked against.
log "Recording manifest"
{
  echo "stamp:        $STAMP"
  echo "commit:       $(git rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "db_archive:   $(basename "$DB_FILE")"
  echo "db_sha256:    $(shasum -a 256 "$DB_FILE" | cut -d' ' -f1)"
  echo "files_archive:$(basename "$FILES_FILE")"
  echo "files_sha256: $(shasum -a 256 "$FILES_FILE" | cut -d' ' -f1)"
  echo "decrypt_with: $DECRYPT_HINT"
  echo ""
  # Taken inside the same snapshot as the dump (see the header), so they describe the dumped instant
  # exactly, writes that landed afterwards included or not.
  echo "row counts at backup time (compare after restore):"
  echo "$COUNTS"
  echo ""
  echo "file count in uploads volume:"
  wc -l < "$UP_DIR/list" | tr -d ' '
  echo ""
  # One line per file in the archive (random names, no personal data): the restore test verifies every
  # restored file against these.
  echo "file sha256 (restore-test verifies each):"
  cat "$UP_DIR/sums"
} > "$MANIFEST"
chmod 600 "$DB_FILE" "$FILES_FILE" "$MANIFEST"
BACKUP_COMPLETE=1   # the set is whole from here on; a later failure (status file) must not delete it
info "wrote $MANIFEST"

# Machine-readable status for the admin panel (mounted read-only into the API
# container). Only written after every archive verified above.
STATUS_DIR="${STATUS_DIR:-$DEST/status}"
mkdir -p "$STATUS_DIR"
STATUS_FILE="$STATUS_DIR/status.json"
"$SCRIPT_DIR/status-update.sh" --file "$STATUS_FILE" \
  lastBackupAt="$(date -u +%Y-%m-%dT%H:%M:%SZ)" lastBackupStamp="$STAMP" lastBackupFailureAt= lastBackupError= \
  || fail "could not write the backup status file $STATUS_FILE"

# ------------------------------------------------------------- retention ----
# Local retention only. Off-host copies are the caller's responsibility and
# have their own lifecycle — see docs/deployment-runbook.md.
log "Pruning local copies older than ${RETAIN_DAYS}d"
find "$DEST" -maxdepth 1 -type f -name '*-db.sql.gz*'   -mtime "+$RETAIN_DAYS" -print -delete || true
find "$DEST" -maxdepth 1 -type f -name '*-uploads.tar.gz*' -mtime "+$RETAIN_DAYS" -print -delete || true
find "$DEST" -maxdepth 1 -type f -name '*-manifest.txt' -mtime "+$RETAIN_DAYS" -print -delete || true

log "Backup complete: $STAMP"
echo "Copy these OFF this host now — a backup on the same machine as the"
echo "database does not survive the failure it exists for."
