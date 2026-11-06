#!/usr/bin/env bash
#
# Rehearses the schema migrations on DISPOSABLE databases only:
#   1. FRESH: every migration on an empty database; no drift against schema.prisma; the new columns and the registered source exist.
#   2. UPGRADE: a read-only pg_dump of an existing database (a legacy copy) restored into a new disposable database, then `migrate deploy`:
#      every pre-existing table must be byte-for-byte identical afterwards (row counts and a content hash per table), except JobSource, which only
#      GAINS columns (compared on the old columns) and, possibly, the newly registered source row.
# Usage (from the repository root, with the stack's Postgres container running):
#   scripts/rehearse-migration-upgrade.sh <source-database> [<source-database> ...]
# Set UPGRADE_NOTES_SQL='select ...' to print a one-line fact about the upgraded copy (for example what a data backfill did).
# Set OLD_CLIENT=<previous checkout>/node_modules/@prisma/client to also run the previous release's client against each upgraded copy (rollback boundary).
# The source databases are only READ (pg_dump); they are never altered. Created databases are dropped at the end.
set -uo pipefail
PGC="${PG_CONTAINER:-aise-postgres}"; PGU="${PG_USER:-postgres}"; PGPW="${PG_PASSWORD:-postgrespassword}"; PGHOST_PORT="${PG_HOST_PORT:-127.0.0.1:5433}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"; API="$HERE/apps/api"
STAMP="$(date +%s)"; FAILS=0; CREATED=()
ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; FAILS=$((FAILS+1)); }
psqlc() { docker exec -i "$PGC" psql -U "$PGU" -v ON_ERROR_STOP=1 -At "$@"; }
url() { echo "postgresql://$PGU:$PGPW@$PGHOST_PORT/$1?schema=public"; }
mkdb() { psqlc -d postgres -c "CREATE DATABASE \"$1\"" >/dev/null && CREATED+=("$1"); }
cleanup() { for d in "${CREATED[@]:-}"; do [ -n "$d" ] && psqlc -d postgres -c "DROP DATABASE IF EXISTS \"$d\" WITH (FORCE)" >/dev/null 2>&1; done; }
trap cleanup EXIT
deploy() { ( cd "$API" && DATABASE_URL="$(url "$1")" npx prisma migrate deploy 2>&1 | tail -4 ); }
drift() { ( cd "$API" && npx prisma migrate diff --from-url "$(url "$1")" --to-schema-datamodel prisma/schema.prisma --exit-code >/dev/null 2>&1 ); }
EXPECTED="$(ls -d "$API"/prisma/migrations/*/ | wc -l | tr -d ' ')"
# One line per table: name|rows|content hash. When RESTRICT_COLS (a file of "Table.column" lines) is set, only those columns and, for JobSource, only the
# sources that existed before are hashed, so what an upgrade ADDS (columns, newly registered sources) is not mistaken for a change to existing data.
fingerprint() {
  local db="$1" t cols keys expr where
  for t in $(psqlc -d "$db" -c "select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations' order by 1"); do
    expr="to_jsonb(t)"; where=""
    if [ -n "${RESTRICT_COLS:-}" ]; then
      cols="$(grep "^$t\." "$RESTRICT_COLS" | cut -d. -f2 | sed "s/.*/'&'/" | paste -sd, -)"
      [ -n "$cols" ] && expr="(select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(to_jsonb(t)) as e(k, v) where k in ($cols))"
      if [ "$t" = "JobSource" ] && [ -n "${RESTRICT_KEYS:-}" ]; then where="where t.key in ($RESTRICT_KEYS)"; fi
    fi
    echo "$t|$(psqlc -d "$db" -c "select count(*)||'|'||coalesce(md5(string_agg(($expr)::text, '~' order by ($expr)::text)),'') from \"$t\" t $where")"
  done
}
columns_of() { psqlc -d "$1" -c "select table_name||'.'||column_name from information_schema.columns where table_schema='public' order by 1"; }

echo "== 1. FRESH database, all $EXPECTED migrations"
F="aise_rehearse_fresh_$STAMP"; mkdb "$F"; deploy "$F" >/dev/null
N="$(psqlc -d "$F" -c "select count(*) from _prisma_migrations where finished_at is not null")"
[ "$N" = "$EXPECTED" ] && ok "fresh: $N of $EXPECTED migrations applied" || bad "fresh: $N of $EXPECTED migrations applied"
drift "$F" && ok "fresh: no drift against schema.prisma" || bad "fresh: schema drift"
[ "$(psqlc -d "$F" -c "select count(*) from information_schema.columns where table_name='JobSource' and column_name in ('leaseOwner','leaseHeartbeatAt','cooldownUntil','cooldownReason','cooldownCount')")" = 5 ] && ok "fresh: JobSource has the 5 new columns" || bad "fresh: JobSource columns"
[ "$(psqlc -d "$F" -c "select count(*) from information_schema.columns where table_name='SourceDiscoveryProgress' and column_name='headReachedEnd'")" = 1 ] && ok "fresh: SourceDiscoveryProgress.headReachedEnd exists" || bad "fresh: headReachedEnd"
[ "$(psqlc -d "$F" -c "select count(*) from \"JobSource\" where key='xsolla' and enabled and not scheduled")" = 1 ] && ok "fresh: xsolla registered, enabled, NOT scheduled" || bad "fresh: xsolla row"
[ "$(psqlc -d "$F" -c "select count(*) from \"JobSource\" where scheduled")" = "$(psqlc -d "$F" -c "select count(*) from \"JobSource\" where scheduled and key='glorri'")" ] && ok "fresh: no source other than Glorri's importer is scheduled" || bad "fresh: unexpected scheduled sources"

for SRC in "$@"; do
  echo "== 2. UPGRADE of a legacy copy of $SRC"
  U="aise_rehearse_up_${STAMP}_$(echo "$SRC" | tr -c 'a-z0-9\n' '_' | cut -c1-20)"; mkdb "$U"
  docker exec "$PGC" pg_dump -U "$PGU" --no-owner --no-privileges "$SRC" | psqlc -d "$U" -q >/dev/null 2>&1 || { bad "restore of $SRC copy failed"; continue; }
  BEFORE_MIG="$(psqlc -d "$U" -c "select count(*) from _prisma_migrations where finished_at is not null")"
  columns_of "$U" > "/tmp/rehearse-cols-$STAMP.txt"
  RESTRICT_KEYS="$(psqlc -d "$U" -c "select string_agg(quote_literal(key), ',') from \"JobSource\"" 2>/dev/null || true)"
  fingerprint "$U" > "/tmp/rehearse-before-$STAMP.txt"
  ROWS="$(awk -F'|' '{s+=$2} END{print s}' "/tmp/rehearse-before-$STAMP.txt")"
  echo "      legacy copy: $BEFORE_MIG migrations applied, $(wc -l < "/tmp/rehearse-before-$STAMP.txt" | tr -d ' ') tables, $ROWS rows"
  deploy "$U" >/dev/null
  AFTER_MIG="$(psqlc -d "$U" -c "select count(*) from _prisma_migrations where finished_at is not null")"
  [ "$AFTER_MIG" = "$EXPECTED" ] && ok "upgrade: $BEFORE_MIG -> $AFTER_MIG migrations applied" || bad "upgrade: $AFTER_MIG of $EXPECTED"
  RESTRICT_COLS="/tmp/rehearse-cols-$STAMP.txt" RESTRICT_KEYS="$RESTRICT_KEYS" fingerprint "$U" > "/tmp/rehearse-after-$STAMP.txt"
  sort "/tmp/rehearse-before-$STAMP.txt" > "/tmp/rehearse-b-$STAMP.txt"; sort "/tmp/rehearse-after-$STAMP.txt" > "/tmp/rehearse-a-$STAMP.txt"
  LOST="$(comm -23 "/tmp/rehearse-b-$STAMP.txt" "/tmp/rehearse-a-$STAMP.txt")"
  if [ -z "$LOST" ]; then ok "upgrade: every pre-existing table identical (rows + content hash, compared on the columns and sources that existed before)"; else bad "upgrade: pre-existing tables changed:"; echo "$LOST" | head; fi
  NEWTABLES="$(comm -13 <(cut -d'|' -f1 "/tmp/rehearse-b-$STAMP.txt" | sort) <(cut -d'|' -f1 "/tmp/rehearse-a-$STAMP.txt" | sort) | tr '\n' ' ')"
  [ -z "$NEWTABLES" ] && echo "      no new tables" || echo "      tables added by the upgrade (empty unless noted): $NEWTABLES"
  drift "$U" && ok "upgrade: no drift against schema.prisma" || bad "upgrade: schema drift"
  echo "      key tables: $(grep -E '^(User|Resume|DocumentSnapshot|DocumentCharge|EmailApplication|Job|Match|JobSource)\|' "/tmp/rehearse-after-$STAMP.txt" | awk -F'|' '{printf "%s=%s ", $1, $2}')"
  if [ -n "${READ_CHECK:-}" ]; then ( cd "$API" && DATABASE_URL="$(url "$U")" npx ts-node -r tsconfig-paths/register --transpile-only "$READ_CHECK" ) && ok "upgrade: integrated code reads documents, allowances and application snapshots" || bad "upgrade: integrated read check failed"; fi
  if [ -n "${UPGRADE_NOTES_SQL:-}" ]; then echo "      notes: $(psqlc -d "$U" -c "$UPGRADE_NOTES_SQL" | tr '\n' ' ')"; fi
  if [ -n "${OLD_CLIENT:-}" ]; then DATABASE_URL="$(url "$U")" node "$HERE/scripts/rollback-schema-compat-check.js" && ok "rollback: the previous release's Prisma client reads and writes the upgraded copy (new columns take their defaults)" || bad "rollback: the previous release's client failed on the upgraded copy"; fi
  rm -f /tmp/rehearse-*-$STAMP.txt
done
echo; [ "$FAILS" = 0 ] && echo "ALL PASSED" || echo "$FAILS FAILED"; exit "$FAILS"
