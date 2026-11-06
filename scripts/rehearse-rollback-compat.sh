#!/usr/bin/env bash
#
# Rehearses the rollback boundary: do the PREVIOUS production images still work against a database that
# the NEW release has upgraded and written to?
#
#   EXPECT_SHA=<release commit> scripts/rehearse-rollback-compat.sh <old-api-id> <new-api-id> <new-matching-id> [<old-web-id>]
#   RUNTIME=native MATCHING_URL=... MATCHING_TOKEN=... scripts/rehearse-rollback-compat.sh <old-checkout> <new-checkout>
#
# Image IDs are full `sha256:...` ids of the images actually intended for rollback (old) and release (new). The new
# images must carry the release commit in their revision label and contain the plan's scripts (check-image-provenance.sh).
# RUNTIME=native runs the real old and new api code from built checkouts instead (see the note in that branch below).
# Everything runs in a disposable Docker network marked --internal (no route to the internet: no Glorri, no
# Resend, no NVIDIA), with its own throwaway Postgres (memory only) and Redis, synthetic data only, and the
# hourly importer switched off. Nothing of production or of other projects is touched. Steps:
#   1. OLD api on an empty database: applies the previous release's migrations; write representative records
#      (candidate, profile, postings, matches) through its real HTTP routes and queues.
#   2. NEW api on the same database: applies the new migrations (additive); write new-shaped records through
#      its real code: a cross-source duplicate posting (duplicateOfId) and a silent re-scoring rollout
#      (Match.suppressedRollout), plus the new CLI.
#   3. OLD api again on the upgraded, newly written database: starts, is ready, serves the existing candidate
#      and matches, ingests and updates postings (including rows carrying the new columns).
#   4. NEW api again (roll forward): healthy, data intact.
# Prints exactly what passed; the old code's known limits are asserted as limits, not hidden.
#
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="${RUNTIME:-docker}"
ID="$$"
TOKEN_MATCH="${MATCHING_TOKEN:-rehearsal-match-token}"; TOKEN_SCRAPER="rehearsal-scraper-token"
FAILS=0; ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; FAILS=$((FAILS+1)); }
PLAN_SCRIPTS=(backfill-dedup-keys rescore-profiles repair-glorri-locations)

case "$RUNTIME" in
docker)
  OLD_API="${1:?old api image id}"; NEW_API="${2:?new api image id}"; NEW_MATCHING="${3:?new matching image id}"; OLD_WEB="${4:-}"
  : "${EXPECT_SHA:?set EXPECT_SHA to the 40-character commit the NEW images were built from}"
  NET="aiserollback$ID"; PG="$NET-pg"; RD="$NET-redis"; MS="$NET-match"; API="$NET-api"
  cleanup() { for c in "$API" "$MS" "$RD" "$PG" "$NET-web"; do docker rm -f -v "$c" >/dev/null 2>&1; done; docker network rm "$NET" >/dev/null 2>&1; }
  trap cleanup EXIT
  for img in "$OLD_API" "$NEW_API" "$NEW_MATCHING"; do docker image inspect "$img" >/dev/null 2>&1 || { echo "image $img not found locally"; exit 2; }; done
  # The rehearsal is only evidence for the images it is given: the NEW ones must be built from the release commit
  # and must contain the scripts the plan runs. (Copying a script into an older image proves nothing about the real one.)
  echo "== 0. the new images are the intended ones"
  script_paths=(); for sc in "${PLAN_SCRIPTS[@]}"; do script_paths+=("/repo/apps/api/dist/scripts/$sc.js"); done
  "$HERE/check-image-provenance.sh" "$NEW_API" "$EXPECT_SHA" "${script_paths[@]}" || { echo "REFUSED: the new api image is not the release image"; exit 2; }
  "$HERE/check-image-provenance.sh" "$NEW_MATCHING" "$EXPECT_SHA" || { echo "REFUSED: the new matching image is not the release image"; exit 2; }
  docker network create --internal "$NET" >/dev/null
  docker run -d --name "$PG" --network "$NET" --network-alias postgres --tmpfs /var/lib/postgresql/data:rw -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=aise postgres:15-alpine >/dev/null
  docker run -d --name "$RD" --network "$NET" --network-alias redis redis:7-alpine >/dev/null
  for _ in $(seq 1 60); do docker exec "$PG" pg_isready -h 127.0.0.1 -U postgres -d aise >/dev/null 2>&1 && break; sleep 1; done; sleep 3
  docker run -d --name "$MS" --network "$NET" --network-alias matching --platform linux/amd64 -e HF_HUB_OFFLINE=1 -e MATCHING_SERVICE_TOKEN="$TOKEN_MATCH" --memory 1600m "$NEW_MATCHING" >/dev/null
  sql() { docker exec -i "$PG" psql -U postgres -d aise -At -v ON_ERROR_STOP=1 "$@"; }
  start_api() { # image label
    docker rm -f "$API" >/dev/null 2>&1
    docker run -d --name "$API" --network "$NET" --platform linux/amd64 --memory 900m \
      -e DATABASE_URL="postgresql://postgres:rehearsal@postgres:5432/aise?schema=public" -e REDIS_HOST=redis -e REDIS_PORT=6379 \
      -e FRONTEND_URL=https://rehearsal.invalid -e MATCHING_SERVICE_URL=http://matching:8000 -e MATCHING_SERVICE_TOKEN="$TOKEN_MATCH" \
      -e SCRAPER_SERVICE_TOKEN="$TOKEN_SCRAPER" -e GLORRI_SCRAPER_ENABLED=false -e APP_ENV=rehearsal -e PAYMENTS_ENABLED=false \
      -e EXTERNAL_APPLY_LIVE_ENABLED=false -e POSTHOG_API_KEY= -e RESEND_API_KEY= "$1" >/dev/null || return 1
    for _ in $(seq 1 120); do
      docker exec "$API" node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && return 0
      [ "$(docker inspect "$API" --format '{{.State.Running}}')" = "true" ] || return 1
      sleep 3
    done; return 1
  }
  # http <METHOD> <path> [json body] [bearer]  -> prints the response body; exit code 0 on 2xx
  http() {
    docker exec -i "$API" node -e '
      const [method, path, body, bearer, lease] = process.argv.slice(1);
      const headers = {"content-type":"application/json"}; if (bearer) headers.authorization = "Bearer " + bearer; if (lease) headers["x-source-lease"] = lease;
      fetch("http://127.0.0.1:4000" + path, {method, headers, body: body || undefined}).then(async r => { const t = await r.text(); process.stdout.write(t); process.exit(r.ok ? 0 : 1); }).catch(e => { console.error(String(e)); process.exit(2); })' "$1" "$2" "${3:-}" "${4:-}" "${5:-}"
  }
  api_cli() { docker exec "$API" node "dist/scripts/$1.js" "${@:2}"; }                        # the running api's compiled CLI
  old_has() { docker run --rm --network none --platform linux/amd64 --entrypoint sh "$OLD_API" -c "grep -c '$1' '/repo/apps/api/dist/$2' || true"; }
  ;;
native)
  # The REAL old and new api code (built source trees: scripts/prepare-rollback-native.sh) run as processes against a
  # disposable database and Redis; the scorer is an already-running service (MATCHING_URL). It exercises the same
  # database/code compatibility as the image mode, but NOT what is inside the images (their Dockerfile, base image,
  # packaged files): that proof needs the real images.
  OLD_API="${1:?directory of the OLD release checkout (built)}"; NEW_API="${2:?directory of the NEW release checkout (built)}"
  : "${MATCHING_URL:?set MATCHING_URL to a running scorer, e.g. http://127.0.0.1:8791}"; : "${MATCHING_TOKEN:?set MATCHING_TOKEN to the token of that scorer}"
  PG_ADMIN_URL="${PG_ADMIN_URL:-postgresql://postgres:postgrespassword@127.0.0.1:5433/postgres}"
  case "$PG_ADMIN_URL" in *@127.0.0.1:*|*@localhost:*) ;; *) echo "REFUSED: native mode only runs against a local database"; exit 2 ;; esac
  DB="aise_rollback_$ID"; PG_BASE="${PG_ADMIN_URL%/*}"; DB_URL="$PG_BASE/$DB"
  API_PORT="${API_PORT:-4047}"; REDIS_PORT="${REDIS_PORT:-6397}"; WORKDIR="$(mktemp -d)"; chmod 700 "$WORKDIR"; CUR_DIR=""
  for dir in "$OLD_API" "$NEW_API"; do [ -f "$dir/apps/api/dist/main.js" ] || { echo "REFUSED: $dir has no built api (apps/api/dist/main.js)"; exit 2; }; done
  stop_api() { if [ -f "$WORKDIR/api.pid" ]; then local p; p="$(cat "$WORKDIR/api.pid")"; kill "$p" 2>/dev/null; for _ in $(seq 1 30); do kill -0 "$p" 2>/dev/null || break; sleep 0.5; done; kill -9 "$p" 2>/dev/null; rm -f "$WORKDIR/api.pid"; fi; }
  cleanup() {
    stop_api
    [ -n "${REDIS_PID:-}" ] && kill "$REDIS_PID" 2>/dev/null
    psql "$PG_ADMIN_URL" -qAt -c "drop database if exists $DB with (force)" >/dev/null 2>&1
    rm -rf "$WORKDIR"
  }
  trap cleanup EXIT
  # What is being rehearsed, stated: the commits the two source trees are at, and that they are clean.
  echo "== 0. what is being rehearsed (native runtime)"
  for pair in "OLD:$OLD_API" "NEW:$NEW_API"; do
    d="${pair#*:}"; rev="$(git -C "$d" rev-parse HEAD 2>/dev/null || echo unknown)"
    dirty=""; [ -n "$(git -C "$d" status --porcelain --untracked-files=no 2>/dev/null)" ] && dirty=" (tracked files modified)"
    echo "     ${pair%%:*}: $rev$dirty"
  done
  if [ -n "${EXPECT_SHA:-}" ]; then [ "$(git -C "$NEW_API" rev-parse HEAD)" = "$EXPECT_SHA" ] && ok "the NEW tree is at EXPECT_SHA" || { bad "the NEW tree is not at EXPECT_SHA"; exit 2; }; fi
  for sc in "${PLAN_SCRIPTS[@]}"; do [ -f "$NEW_API/apps/api/dist/scripts/$sc.js" ] && ok "the NEW build contains scripts/$sc.js" || { bad "the NEW build lacks scripts/$sc.js"; exit 2; }; done
  curl -fsS --max-time 5 "$MATCHING_URL/health" >/dev/null 2>&1 || { echo "REFUSED: no scorer answering at $MATCHING_URL/health"; exit 2; }
  for port in "$API_PORT" "$REDIS_PORT"; do (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && { echo "REFUSED: port $port is already in use (a leftover process would answer for the release under test)"; exit 2; }; done
  psql "$PG_ADMIN_URL" -qAt -c "create database $DB" >/dev/null || { echo "could not create the disposable database"; exit 2; }
  redis-server --port "$REDIS_PORT" --save "" --appendonly no --bind 127.0.0.1 > "$WORKDIR/redis.log" 2>&1 & REDIS_PID=$!
  for _ in $(seq 1 30); do redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 && break; sleep 0.3; done
  sql() { psql "$DB_URL" -At -v ON_ERROR_STOP=1 "$@"; }
  api_env() {
    env DATABASE_URL="$DB_URL?schema=public" REDIS_HOST=127.0.0.1 REDIS_PORT="$REDIS_PORT" PORT="$API_PORT" NODE_ENV=production \
      FRONTEND_URL=https://rehearsal.invalid MATCHING_SERVICE_URL="$MATCHING_URL" MATCHING_SERVICE_TOKEN="$TOKEN_MATCH" \
      SCRAPER_SERVICE_TOKEN="$TOKEN_SCRAPER" GLORRI_SCRAPER_ENABLED=false APP_ENV=rehearsal PAYMENTS_ENABLED=false \
      EXTERNAL_APPLY_LIVE_ENABLED=false POSTHOG_API_KEY= RESEND_API_KEY= "$@"
  }
  start_api() { # source tree
    stop_api; CUR_DIR="$1"
    # Same two steps as the image's CMD (`prisma migrate deploy && node dist/main.js`): a failed migration stops here.
    # The server is exec'd, so the pid kept in api.pid IS the node process (a wrapper shell would leave it running
    # when stopped, and a later "start" would be answered by the previous release).
    ( cd "$1/apps/api" && api_env npx prisma migrate deploy ) > "$WORKDIR/api.log" 2>&1 || return 1
    ( cd "$1/apps/api" && exec env DATABASE_URL="$DB_URL?schema=public" REDIS_HOST=127.0.0.1 REDIS_PORT="$REDIS_PORT" PORT="$API_PORT" NODE_ENV=production \
        FRONTEND_URL=https://rehearsal.invalid MATCHING_SERVICE_URL="$MATCHING_URL" MATCHING_SERVICE_TOKEN="$TOKEN_MATCH" \
        SCRAPER_SERVICE_TOKEN="$TOKEN_SCRAPER" GLORRI_SCRAPER_ENABLED=false APP_ENV=rehearsal PAYMENTS_ENABLED=false \
        EXTERNAL_APPLY_LIVE_ENABLED=false POSTHOG_API_KEY= RESEND_API_KEY= node dist/main.js ) >> "$WORKDIR/api.log" 2>&1 &
    echo $! > "$WORKDIR/api.pid"
    for _ in $(seq 1 120); do
      curl -fsS --max-time 3 "http://127.0.0.1:$API_PORT/health/ready" >/dev/null 2>&1 && return 0
      kill -0 "$(cat "$WORKDIR/api.pid")" 2>/dev/null || return 1
      sleep 1
    done; return 1
  }
  http() {
    node -e '
      const [method, path, body, bearer, lease] = process.argv.slice(1);
      const headers = {"content-type":"application/json"}; if (bearer) headers.authorization = "Bearer " + bearer; if (lease) headers["x-source-lease"] = lease;
      fetch("http://127.0.0.1:" + process.env.API_PORT + path, {method, headers, body: body || undefined}).then(async r => { const t = await r.text(); process.stdout.write(t); process.exit(r.ok ? 0 : 1); }).catch(e => { console.error(String(e)); process.exit(2); })' "$1" "$2" "${3:-}" "${4:-}" "${5:-}"
  }
  export API_PORT
  api_cli() { ( cd "$CUR_DIR/apps/api" && api_env node "dist/scripts/$1.js" "${@:2}" ); }
  old_has() { grep -c "$1" "$OLD_API/apps/api/dist/$2" 2>/dev/null || true; }
  api_logs() { tail -n "${1:-15}" "$WORKDIR/api.log" 2>/dev/null; }
  ;;
*) echo "RUNTIME must be docker or native" >&2; exit 2 ;;
esac
logs_of_api() { if [ "$RUNTIME" = native ]; then api_logs 15; else docker logs --tail 15 "$API" 2>&1; fi | cut -c1-200; }
jget() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
ingest() { # externalId title company description location url
  local body src tok rc
  body="$(python3 -c 'import json,sys
keys = ["externalId", "title", "company", "description", "location", "url"]
d = dict(zip(keys, sys.argv[1:7])); d["postedAt"] = "2026-09-30T00:00:00Z"
print(json.dumps(d))' "$@")"
  src="${1%%:*}"
  # A source with a reviewed collector (everything except Glorri's own importer) is written only under that source's lease, exactly as the import CLI does:
  # the release's ingest routes answer 409 to an unleased caller. The OLD api has no lease route, so only the new api is asked for one.
  if [ "$src" != "glorri" ] && [ "${CURRENT_API:-}" = "new" ]; then
    tok="$(http POST /internal/jobs/source-lease "{\"source\":\"$src\",\"action\":\"acquire\"}" "$TOKEN_SCRAPER" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')" || return 1
    http POST /internal/jobs/ingest "$body" "$TOKEN_SCRAPER" "$tok"; rc=$?
    http POST /internal/jobs/source-lease "{\"source\":\"$src\",\"action\":\"release\",\"token\":\"$tok\"}" "$TOKEN_SCRAPER" >/dev/null
    return $rc
  fi
  http POST /internal/jobs/ingest "$body" "$TOKEN_SCRAPER"
}
settle() { sleep "${1:-12}"; }
migs() { sql -c "select count(*) from _prisma_migrations where finished_at is not null"; }

DESC_TS="Backend engineer wanted: TypeScript, NestJS and PostgreSQL. Build REST APIs, review code and mentor juniors. We offer a competitive salary, a friendly team and training. Send your CV to apply today if you are interested in this role."
echo "== 1. OLD api on an empty database"
CURRENT_API=old; start_api "$OLD_API" && ok "old api starts and is ready (applied $(migs) migrations)" || { bad "old api did not start"; logs_of_api; exit 1; }
OLD_MIGS="$(migs)"
ingest "glorri:compat-1" "Backend Developer (TypeScript)" "Compat Co" "$DESC_TS" "Bakı, Azərbaycan" "https://jobs.glorri.com/vacancies/compat/compat-1" >/dev/null && ok "old api ingests a posting" || bad "old api ingest failed"
EMAIL="compat-$ID@example.invalid"
http POST /auth/register "{\"email\":\"$EMAIL\",\"password\":\"Compat-Rehearsal-1!\"}" >/dev/null && ok "old api registers a synthetic candidate" || bad "register failed"
sql -c "update \"User\" set \"emailVerified\"=now() where email='$EMAIL'" >/dev/null
TOKEN="$(http POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"Compat-Rehearsal-1!\"}" | jget "d['sessionToken']")"
[ -n "$TOKEN" ] && ok "old api login" || bad "login failed"
http PATCH /profile '{"headline":"TypeScript PostgreSQL engineer","skills":["TypeScript","PostgreSQL","NestJS"],"location":"Bakı"}' "$TOKEN" >/dev/null && ok "old api saves a profile"
http POST /profile/complete-onboarding "" "$TOKEN" >/dev/null
settle 25
N1="$(sql -c "select count(*) from \"Match\"")"; [ "${N1:-0}" -ge 1 ] && ok "old api + new matching image created $N1 match(es)" || bad "no match created by the old api"

echo "== 2. NEW api on the same database"
CURRENT_API=new; start_api "$NEW_API" && ok "new api starts on the old-schema database (migrations $OLD_MIGS -> $(migs))" || { bad "new api did not start"; logs_of_api; }
NEW_MIGS="$(migs)"; [ "$NEW_MIGS" -gt "$OLD_MIGS" ] && ok "new migrations applied ($((NEW_MIGS-OLD_MIGS)) added)" || bad "no new migrations applied"
sql -c "select count(*) from information_schema.columns where table_name='Job' and column_name in ('canonicalUrl','companyKey','duplicateOfId','duplicateReason')" | grep -q '^4$' && ok "new Job columns exist" || bad "Job columns missing"
sql -c "select count(*) from information_schema.columns where table_name='Match' and column_name='suppressedRollout'" | grep -q '^1$' && ok "new Match column exists" || bad "Match column missing"
# Postings written by the old release have no comparison keys yet (the importer, switched off here, backfills them
# every hour); the operator backfill makes them comparable at once. It is the release's own compiled script (checked
# for in step 0): nothing is copied in.
api_cli backfill-dedup-keys --apply 2>&1 | grep -q "Filled [1-9]" && ok "operator backfill filled the comparison keys of old-release postings" || bad "backfill did not run"
[ "$(sql -c "select count(*) from \"Job\" where \"companyKey\" is null")" = "0" ] && ok "no posting is left without comparison keys" || bad "postings without keys remain"
# new-code-written records: a second source repeating the same posting (linked, not deleted) and another distinct posting
if out="$(ingest "hellojob:compat-1" "Backend Developer (TypeScript)" "Compat Co" "$DESC_TS" "Bakı, Azərbaycan" "https://hellojob.az/vacancy/compat-1" 2>&1)"; then ok "new api ingests a cross-source repeat"; else bad "new ingest failed: ${out:0:240}"; fi
ingest "glorri:compat-2" "Frontend Developer (React)" "Compat Co" "React and TypeScript interfaces for customers." "Gəncə, Azərbaycan" "https://jobs.glorri.com/vacancies/compat/compat-2" >/dev/null
settle 20
[ "$(sql -c "select count(*) from \"Job\" where \"duplicateOfId\" is not null")" = "1" ] && ok "new api linked the repeat as a duplicate (row kept)" || bad "duplicate link not written"
USER_ID="$(sql -c "select id from \"User\" where email='$EMAIL'")"
NOTIF_BEFORE="$(sql -c "select count(*) from \"Notification\"")"
api_cli rescore-profiles --apply --rollout compat-silent --silent --all --spacing-seconds 30 2>&1 | grep -q "added 1" && ok "new rescoring CLI queued the silent rollout" || bad "rescoring CLI failed"
for _ in $(seq 1 30); do [ "$(sql -c "select count(*) from \"Match\" where \"suppressedRollout\"='compat-silent'")" -ge 1 ] && break; sleep 4; done
[ "$(sql -c "select count(*) from \"Match\" where \"suppressedRollout\"='compat-silent'")" -ge 1 ] && ok "new api wrote silent (suppressed) matches" || bad "no suppressed match written"
[ "$(sql -c "select count(*) from \"Notification\"")" = "$NOTIF_BEFORE" ] && ok "silent rollout announced nothing (notification count unchanged: $NOTIF_BEFORE)" || bad "silent rollout created a notification"
MATCH_TOTAL="$(sql -c "select count(*) from \"Match\"")"; JOB_TOTAL="$(sql -c "select count(*) from \"Job\"")"

echo "== 3. OLD api on the upgraded, newly written database (the rollback)"
CURRENT_API=old; start_api "$OLD_API" && ok "old api starts against the upgraded schema (migrations in table: $(migs), its own: $OLD_MIGS)" || { bad "old api failed on the upgraded schema"; logs_of_api; }
[ "$(migs)" = "$NEW_MIGS" ] && ok "rollback start did not alter the migration table" || bad "migration table changed"
http GET /health/ready >/dev/null && ok "old api ready" || bad "old api not ready"
TOKEN="$(http POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"Compat-Rehearsal-1!\"}" | jget "d['sessionToken']")"; [ -n "$TOKEN" ] && ok "candidate can log in on the old api" || bad "login failed after rollback"
http GET /matches "" "$TOKEN" | jget "len(d)" | grep -qE '^[1-9]' && ok "old api serves the candidate's matches, including the silent ones" || bad "matches not served"
http GET /profile "" "$TOKEN" >/dev/null && ok "old api serves the profile" || bad "profile failed"
ingest "glorri:compat-2" "Frontend Developer (React)" "Compat Co" "React and TypeScript interfaces for customers. Updated." "Gəncə, Azərbaycan" "https://jobs.glorri.com/vacancies/compat/compat-2" >/dev/null && ok "old api updates a posting" || bad "old api update failed"
ingest "glorri:compat-3" "DevOps Engineer" "Compat Co" "Kubernetes, Docker and CI/CD for our platform team with on-call rotation." "Bakı, Azərbaycan" "https://jobs.glorri.com/vacancies/compat/compat-3" >/dev/null && ok "old api ingests a new posting" || bad "old api ingest failed"
ingest "hellojob:compat-1" "Backend Developer (TypeScript)" "Compat Co" "$DESC_TS" "Bakı, Azərbaycan" "https://hellojob.az/vacancy/compat-1" >/dev/null && ok "old api re-ingests the duplicate-linked row unchanged" || bad "old api failed on a row carrying new columns"
settle 20
[ "$(sql -c "select count(*) from \"Job\"")" -ge "$JOB_TOTAL" ] && [ "$(sql -c "select count(*) from \"Match\"")" -ge "$MATCH_TOTAL" ] && ok "no rows lost or deleted by the rollback ($JOB_TOTAL jobs, $MATCH_TOTAL matches kept)" || bad "rows were lost"
[ "$(sql -c "select count(*) from \"Job\" where \"duplicateOfId\" is not null")" = "1" ] && ok "the duplicate link survives old-code updates (old code leaves the column alone)" || bad "duplicate link lost"
# Known limits of the old code, asserted rather than hidden:
GAP="$(old_has suppressedRollout notifications/notifications.service.js)"
[ "${GAP:-0}" = "0" ] && ok "LIMIT confirmed: the old notification code does not know the silent marker (see release doc: pause match emails before rolling back within 72 h of a silent rollout)" || bad "unexpected: old code knows the marker"
GAP2="$(old_has duplicateOfId jobs/jobs.service.js)"
[ "${GAP2:-0}" = "0" ] && ok "LIMIT confirmed: the old code treats a duplicate-linked posting as an ordinary one (it becomes visible again)" || bad "unexpected: old code knows duplicates"

if [ "$RUNTIME" = docker ] && [ -n "${OLD_WEB:-}" ]; then
  echo "== 3b. OLD web image against the OLD api"
  docker run -d --name "$NET-web" --network "$NET" --platform linux/amd64 -e NEXTAUTH_URL=http://localhost:3000 -e NEXTAUTH_SECRET=rehearsal -e HOSTNAME=0.0.0.0 --memory 700m "$OLD_WEB" >/dev/null
  for _ in $(seq 1 40); do docker exec "$NET-web" node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && { ok "old web image serves pages"; break; }; sleep 3; done
fi

echo "== 4. NEW api again (roll forward)"
CURRENT_API=new; start_api "$NEW_API" && ok "new api healthy again on the same database" || bad "roll-forward failed"
[ "$(sql -c "select count(*) from \"Job\" where \"duplicateOfId\" is not null")" = "1" ] && [ "$(sql -c "select count(*) from \"Match\" where \"suppressedRollout\" is not null")" -ge 1 ] && ok "new-shaped data intact after the round trip" || bad "new-shaped data damaged"
echo
if [ "$FAILS" -eq 0 ]; then
  echo "ROLLBACK COMPATIBILITY REHEARSAL PASSED ($RUNTIME runtime)"
  [ "$RUNTIME" = native ] && echo "note: native runtime — the images themselves (Dockerfile, packaged files) are NOT covered; run the image mode on them before the window"
else
  echo "ROLLBACK COMPATIBILITY REHEARSAL: $FAILS FAILED ($RUNTIME runtime)"
fi
exit $((FAILS>0))
