#!/usr/bin/env bash
#
# Runtime proof of backup.sh's failure behaviour (disposable Postgres in memory, a scratch uploads volume, a real
# age key pair, the real backup.sh):
#
#   scripts/test-backup-stream-check.sh
#   BACKUP_SCRIPT=/path/to/older/backup.sh scripts/test-backup-stream-check.sh   # show an older version failing
#
# Scenarios (each asserts the outcome AND what is left behind):
#   1 healthy run            -> exit 0; archives decrypt and hold the data; no session, process or temp dir left
#   2 corrupt database stream-> fails AT ONCE (not at the timeout) naming the integrity check; no partial archives
#   3 hung stream checker    -> fails within the configured bound, checker process killed, nothing left
#   4 encryption fails       -> fails promptly, no hang, nothing left
#   5 uploads archive fails once -> the retry succeeds and the set is whole (regression cover: the older script also passed
#                            this, by accident - see the comment on stream_check - so it does not discriminate)
#   6 SIGTERM mid-run        -> the snapshot transaction is ended, temp dir gone, no partial archives
# "Nothing left" = no `idle in transaction` session in the database, no checker process, no scratch directory,
# no partial archive without a manifest in the destination.
#
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BACKUP="${BACKUP_SCRIPT:-$HERE/backup.sh}"
[ -x "$BACKUP" ] || chmod +x "$BACKUP" 2>/dev/null
ID="$$"; PG="aise-streamchk-pg-$ID"; VOL="aise-streamchk-up-$ID"; WORK="$(mktemp -d)"; chmod 700 "$WORK"
FAILS=0; ok() { printf 'PASS  %s\n' "$*"; }; bad() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS+1)); }
cleanup() { docker rm -f -v "$PG" >/dev/null 2>&1; docker volume rm -f "$VOL" >/dev/null 2>&1; pkill -f "sleep 3141" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT
command -v age-keygen >/dev/null || { echo "age-keygen is required"; exit 2; }
REAL_GZIP="$(command -v gzip)"; REAL_AGE="$(command -v age)"; export REAL_GZIP REAL_AGE
export STATE="$WORK/state"; mkdir -p "$STATE" "$WORK/bin" "$WORK/tmp"

age-keygen -o "$WORK/key" >/dev/null 2>&1; chmod 600 "$WORK/key"; RECIP="$(age-keygen -y "$WORK/key")"

docker run -d --name "$PG" --tmpfs /var/lib/postgresql/data:rw -e POSTGRES_PASSWORD=x -e POSTGRES_DB=aise postgres:15-alpine >/dev/null
READY=0; for _ in $(seq 1 90); do
  if docker exec "$PG" pg_isready -h 127.0.0.1 -U postgres -d aise >/dev/null 2>&1; then READY=$((READY+1)); [ "$READY" -ge 2 ] && break; else READY=0; fi; sleep 1
done
psql_() { docker exec -i "$PG" psql -U postgres -d aise -At "$@"; }
# Just enough schema for backup.sh's row counts; the data carries a marker the decrypted dump must contain.
psql_ -q -v ON_ERROR_STOP=1 <<'SQL' || { echo "could not prepare the database"; exit 2; }
create table "User"(id text primary key, email text);
create table "Job"(id text primary key, title text);
insert into "User" values ('u1','stream-check-marker@example.com');
insert into "Job" select 'j'||g, 'T'||g from generate_series(1,2000) g;
SQL
docker volume create "$VOL" >/dev/null
docker run --rm -v "$VOL":/data alpine sh -c 'for i in 1 2 3; do echo seed-$i > /data/seed-$i.txt; done'

# ---- stand-ins that inject faults (everything else is the real tool) ----
cat > "$WORK/bin/gzip" <<'SH'
#!/usr/bin/env bash
mode="$(cat "$STATE/gzip.mode" 2>/dev/null || true)"
# "hang": a checker that consumes the whole stream and then never reports (the case the bounded wait covers).
if [ "${1:-}" = "-t" ]; then [ "$mode" = hang ] && { cat > /dev/null; exec sleep 3141; }; exec "$REAL_GZIP" "$@"; fi
if [ "${1:-}" = "-9" ] && [ "$mode" = corrupt ]; then
  "$REAL_GZIP" "$@" | python3 -c "import sys; d=bytearray(sys.stdin.buffer.read()); d[len(d)//2]^=0xFF; sys.stdout.buffer.write(d)"; exit 0
fi
exec "$REAL_GZIP" "$@"
SH
cat > "$WORK/bin/age" <<'SH'
#!/usr/bin/env bash
if [ -f "$STATE/age.failonce" ] && [[ "$*" == *uploads* ]]; then rm -f "$STATE/age.failonce"; echo "age: injected one-off failure" >&2; exit 1; fi
exec "$REAL_AGE" "$@"
SH
chmod +x "$WORK/bin/gzip" "$WORK/bin/age"

idle_sessions() { psql_ -c "select count(*) from pg_stat_activity where datname='aise' and state like 'idle in transaction%'"; }
settled_idle_sessions() { local n; for _ in $(seq 1 12); do n="$(idle_sessions)"; [ "$n" = 0 ] && break; sleep 0.5; done; echo "$n"; }
leftover_checkers() { pgrep -f "sleep 3141" | wc -l | tr -d ' '; }
partials() { ls "$1" 2>/dev/null | grep -E 'db\.sql|uploads\.tar' | wc -l | tr -d ' '; }
scratch_dirs() { ls "$WORK/tmp" 2>/dev/null | wc -l | tr -d ' '; }

# runs backup.sh; sets RC, ELAPSED, LOG, DEST
run_backup() {
  DEST="$WORK/dest-$1"; shift; rm -rf "$DEST"; LOG="$WORK/log-$$-$RANDOM"; local t0=$SECONDS
  # A hard limit: a regression that hangs the backup must FAIL this test, not hang it.
  env PATH="$WORK/bin:$PATH" TMPDIR="$WORK/tmp" PG_CONTAINER="$PG" PG_DB=aise UPLOADS_VOLUME="$VOL" AISE_BACKUP_AGE_RECIPIENT="${RECIP_OVERRIDE:-$RECIP}" "$@" \
    timeout --kill-after=5 120 "$BACKUP" "$DEST" > "$LOG" 2>&1
  RC=$?; ELAPSED=$((SECONDS - t0))
  [ "$RC" -ne 124 ] || bad "the backup HUNG and was killed after 120s ($*)"
}
nothing_left() { # label
  local n c d; n="$(settled_idle_sessions)"; c="$(leftover_checkers)"; d="$(scratch_dirs)"
  [ "$n" = 0 ] && ok "$1: no snapshot session left in the database" || bad "$1: $n 'idle in transaction' session(s) left in the database"
  [ "$c" = 0 ] && ok "$1: no checker process left" || bad "$1: $c checker process(es) left running"
  [ "$d" = 0 ] && ok "$1: scratch directory removed" || bad "$1: scratch directory left behind"
}
echo "backup script under test: $BACKUP"
[ "$(idle_sessions)" = 0 ] || { echo "precondition: a stray session exists"; exit 2; }

echo "== 1. healthy run"
rm -f "$STATE"/*; run_backup ok
[ "$RC" -eq 0 ] && ok "healthy run exits 0 (${ELAPSED}s)" || { bad "healthy run failed (exit $RC)"; tail -6 "$LOG"; }
M="$(ls "$DEST"/*-manifest.txt 2>/dev/null | head -1)"; DBF="$(ls "$DEST"/*-db.sql.gz.age 2>/dev/null | head -1)"
[ -n "$M" ] && [ -n "$DBF" ] && ok "set written (manifest + archives)" || bad "set incomplete"
[ "$("$REAL_AGE" -d -i "$WORK/key" "$DBF" | "$REAL_GZIP" -dc | grep -c 'stream-check-marker@example.com')" -ge 1 ] && ok "the archive decrypts and holds the data" || bad "archive content not as expected"
grep -q '^Job 2000$' "$M" && ok "manifest counts come from the snapshot (Job 2000)" || bad "manifest counts wrong"
nothing_left "healthy"

echo "== 2. corrupt database stream"
rm -f "$STATE"/*; echo corrupt > "$STATE/gzip.mode"; run_backup corrupt AISE_BACKUP_CHECK_TIMEOUT_SECONDS=40
[ "$RC" -ne 0 ] && ok "a corrupt stream fails the backup" || bad "a corrupt stream was accepted"
grep -q "failed its integrity check" "$LOG" && ok "...naming the integrity check" || { bad "wrong failure message"; tail -4 "$LOG"; }
[ "$ELAPSED" -lt 20 ] && ok "...at once (${ELAPSED}s, bound was 40s), not by waiting for the timeout" || bad "took ${ELAPSED}s: it waited for the timeout instead of reading the verdict"
[ "$(partials "$DEST")" = 0 ] && ok "...and left no partial archives" || bad "partial archives left: $(ls "$DEST")"
nothing_left "corrupt"

echo "== 3. hung stream checker"
rm -f "$STATE"/*; echo hang > "$STATE/gzip.mode"; run_backup hang AISE_BACKUP_CHECK_TIMEOUT_SECONDS=4
[ "$RC" -ne 0 ] && ok "a checker that never answers fails the backup" || bad "a hung checker was accepted"
grep -q "failed its integrity check" "$LOG" && ok "...with the integrity message" || { bad "wrong failure message"; tail -4 "$LOG"; }
[ "$ELAPSED" -ge 3 ] && [ "$ELAPSED" -le 25 ] && ok "...within the bound (${ELAPSED}s for a 4s limit)" || bad "waited ${ELAPSED}s for a 4s limit"
[ "$(partials "$DEST")" = 0 ] && ok "...and left no partial archives" || bad "partial archives left"
nothing_left "hang"

echo "== 4. encryption fails (bad recipient)"
rm -f "$STATE"/*; RECIP_OVERRIDE="not-an-age-recipient" run_backup badkey AISE_BACKUP_CHECK_TIMEOUT_SECONDS=20
[ "$RC" -ne 0 ] && ok "an encryption failure fails the backup" || bad "encryption failure accepted"
[ "$ELAPSED" -lt 20 ] && ok "...promptly (${ELAPSED}s)" || bad "took ${ELAPSED}s"
[ "$(partials "$DEST")" = 0 ] && ok "...and left no partial archives" || bad "partial archives left"
nothing_left "encryption"

echo "== 5. the uploads archive fails once, then succeeds (regression cover)"
rm -f "$STATE"/*; touch "$STATE/age.failonce"; run_backup retry AISE_BACKUP_CHECK_TIMEOUT_SECONDS=20
grep -q "uploads archive attempt 1 failed" "$LOG" && ok "attempt 1 failed as injected" || { bad "the injected failure did not happen"; tail -5 "$LOG"; }
[ "$RC" -eq 0 ] && ok "the retry succeeded and the backup completed (${ELAPSED}s)" || { bad "the retry did not work (exit $RC)"; tail -6 "$LOG"; }
UPF="$(ls "$DEST"/*-uploads.tar.gz.age 2>/dev/null | head -1)"
[ -n "$UPF" ] && [ "$("$REAL_AGE" -d -i "$WORK/key" "$UPF" | tar -tz 2>/dev/null | grep -c seed-)" = 3 ] && ok "the retried archive holds all 3 files" || bad "retried archive is wrong"
nothing_left "retry"

echo "== 6. SIGTERM while the snapshot is held"
rm -f "$STATE"/*; DEST="$WORK/dest-term"; rm -rf "$DEST"; LOG="$WORK/log-term"
env PATH="$WORK/bin:$PATH" TMPDIR="$WORK/tmp" PG_CONTAINER="$PG" PG_DB=aise UPLOADS_VOLUME="$VOL" AISE_BACKUP_AGE_RECIPIENT="$RECIP" AISE_BACKUP_TEST_DELAY_AFTER_SNAPSHOT=40 timeout --kill-after=5 120 "$BACKUP" "$DEST" > "$LOG" 2>&1 &
BP=$!
for _ in $(seq 1 100); do grep -q "snapshot .* held open" "$LOG" 2>/dev/null && break; sleep 0.2; done
[ "$(idle_sessions)" = 1 ] && ok "(precondition) the snapshot transaction is open" || bad "no open snapshot session to terminate"
kill -TERM "$BP"; t0=$SECONDS; wait "$BP" 2>/dev/null; TERM_RC=$?
[ $((SECONDS - t0)) -le 15 ] && ok "the script ended within $((SECONDS - t0))s of SIGTERM (exit $TERM_RC)" || bad "still running after SIGTERM"
[ "$(partials "$DEST")" = 0 ] && ok "no partial archives" || bad "partial archives left"
nothing_left "sigterm"

echo
[ "$FAILS" -eq 0 ] && echo "BACKUP STREAM-CHECK TEST PASSED" || echo "BACKUP STREAM-CHECK TEST: $FAILS FAILED"
exit $((FAILS>0))
