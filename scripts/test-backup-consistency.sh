#!/usr/bin/env bash
#
# Proves a backup taken while the database and the uploads volume keep changing is self-consistent and restores:
#
#   scripts/test-backup-consistency.sh
#
# Disposable Postgres (real migrations, memory only), a scratch uploads volume, a real age key pair created for
# the test, the real backup.sh and restore-test.sh. A writer inserts jobs and adds files throughout; the backup is
# paused for a few seconds right after its snapshot so writes are guaranteed to land between snapshot, dump and
# archive. Passes only if: the live database ends with MORE rows than the manifest recorded (writes happened), yet
# every manifest count equals the restored count and every listed file is byte-identical (restore-test PASSED).
#
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
ID="$$"; PG="aise-consist-pg-$ID"; VOL="aise-consist-up-$ID"; WORK="$(mktemp -d)"; chmod 700 "$WORK"
PORT=$((56000 + ID % 1000))
WRITER_PID=""
cleanup() { [ -n "$WRITER_PID" ] && kill "$WRITER_PID" 2>/dev/null; docker rm -f -v "$PG" >/dev/null 2>&1; docker volume rm -f "$VOL" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT
FAILS=0; ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; FAILS=$((FAILS+1)); }

command -v age-keygen >/dev/null || { echo "age-keygen is required"; exit 2; }
age-keygen -o "$WORK/key" >/dev/null 2>&1; chmod 600 "$WORK/key"; RECIP="$(age-keygen -y "$WORK/key")"
docker run -d --name "$PG" --tmpfs /var/lib/postgresql/data:rw -e POSTGRES_PASSWORD=x -e POSTGRES_DB=aise -p "127.0.0.1:$PORT:5432" postgres:15-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$PG" pg_isready -h 127.0.0.1 -U postgres -d aise >/dev/null 2>&1 && break; sleep 1; done; sleep 3
(cd "$ROOT/apps/api" && DATABASE_URL="postgresql://postgres:x@127.0.0.1:$PORT/aise?schema=public" npx prisma migrate deploy >/dev/null 2>&1) || { echo "migrations failed"; exit 2; }
docker volume create "$VOL" >/dev/null
docker run --rm -v "$VOL":/data alpine sh -c 'for i in 1 2 3; do echo seed-$i > /data/seed-$i.txt; done'
psql_() { docker exec -i "$PG" psql -U postgres -d aise -At "$@"; }
psql_ -q <<'SQL'
insert into "User"(id,email,"hashedPassword","updatedAt") values ('u1','consist@example.com','x',now());
insert into "Resume"(id,"userId","isBase","fileUrl") values ('r1','u1',true,'/uploads/seed-1.txt');
SQL

# A writer that never stops: new jobs (database) and new files (volume).
( i=0; while :; do i=$((i+1))
    psql_ -q -c "insert into \"Job\"(id,\"externalId\",title,company,description,location,url,\"postedAt\",\"contentHash\") values ('w$i','glorri:consist-$i','T','C','d','Bakı','https://x/$i',now(),'h')" >/dev/null 2>&1
    [ $((i % 3)) -eq 0 ] && docker run --rm -v "$VOL":/data alpine sh -c "echo w$i > /data/written-$i.txt" >/dev/null 2>&1
    sleep 0.2; done ) &
WRITER_PID=$!
sleep 1

echo "== backup while writes continue (paused 5 s after the snapshot)"
PG_CONTAINER="$PG" UPLOADS_VOLUME="$VOL" AISE_BACKUP_AGE_RECIPIENT="$RECIP" AISE_BACKUP_TEST_DELAY_AFTER_SNAPSHOT=5 \
  "$HERE/backup.sh" "$WORK/backups" >"$WORK/backup.log" 2>&1 && ok "backup.sh completed under concurrent writes" || { bad "backup.sh failed"; tail -8 "$WORK/backup.log"; }
kill "$WRITER_PID" 2>/dev/null; wait "$WRITER_PID" 2>/dev/null; WRITER_PID=""
STAMP="$(ls "$WORK/backups" | sed -n 's/-manifest.txt$//p' | head -1)"
MANIFEST="$WORK/backups/$STAMP-manifest.txt"
live_jobs="$(psql_ -c 'select count(*) from "Job"')"; man_jobs="$(sed -n 's/^Job //p' "$MANIFEST")"
echo "     live Job rows now: $live_jobs; manifest (snapshot) says: $man_jobs"
[ "${live_jobs:-0}" -gt "${man_jobs:-0}" ] && ok "writes really landed after the snapshot (the test is meaningful)" || bad "no writes landed after the snapshot; test proves nothing"
grep -q "^Job " "$MANIFEST" && ok "manifest records snapshot counts" || bad "manifest has no counts"
live_files="$(docker run --rm -v "$VOL":/data:ro alpine sh -c 'find /data -type f | wc -l' | tr -d ' ')"; man_files="$(sed -n '/^file count/{n;p;}' "$MANIFEST")"
echo "     live files now: $live_files; manifest lists: $man_files"

echo "== restore the exact set and compare"
SCHEMA_FILE="$ROOT/apps/api/prisma/schema.prisma" AISE_BACKUP_AGE_IDENTITY="$WORK/key" STATUS_FILE="" \
  "$HERE/restore-test.sh" "$WORK/backups/$STAMP-db.sql.gz.age" "$WORK/backups/$STAMP-uploads.tar.gz.age" >"$WORK/restore.log" 2>&1 \
  && ok "restore test PASSED: counts equal the snapshot, every listed file byte-identical" || { bad "restore test failed"; tail -12 "$WORK/restore.log"; }
echo; [ "$FAILS" -eq 0 ] && echo "BACKUP CONSISTENCY TEST PASSED" || echo "BACKUP CONSISTENCY TEST: $FAILS FAILED"; exit $((FAILS>0))
