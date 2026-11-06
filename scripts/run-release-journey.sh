#!/usr/bin/env bash
#
# Runs the RELEASE JOURNEY (apps/api/test/support/release-journey.js) on the production host in an ISOLATED throwaway stack (own network, tmpfs Postgres, Redis and
# the release API image), so the live site, its database and its switches are never touched. Real model provider for the documents, real e-mail provider for the
# single application message (to the test destination ONLY), fixture portal for the browser agent (no employer is contacted).
#
#   scripts/run-release-journey.sh <api-image> <driver.js> <test-recipient> <candidate-address> <job-id> <job-id> <job-id>
#   env: TAILOR_AZ_WRITER (default true), JOURNEY_WEBHOOK_CHECK=1 (needs the real EMAIL_APPLY_WEBHOOK_SECRET on the host)
#
# Phase A is the whole journey. Phase B recreates the API WITHOUT a provider key and proves that a failed generation fails honestly and keeps no unit.
# The provider keys come from the production env file into a mode-600 temp file on THIS host and are never printed.
set -euo pipefail
IMAGE="${1:?api image}"; DRIVER="${2:?driver.js}"; TEST_RCPT="${3:?test recipient}"; CAND="${4:?candidate email at the test destination}"; J1="${5:?job}"; J2="${6:?job}"; J3="${7:?job}"
AISE_DIR="${AISE_DIR:-/srv/stacks/aise}"
avail="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"
[ "$avail" -ge 1400 ] || { echo "STOP: only ${avail} MB available (need 1400)"; exit 1; }
WORK="$(umask 077; mktemp -d /tmp/aise-rj.XXXXXX)"; ID="$$"; NET="aiserj$ID"; PG="$NET-pg"; RD="$NET-rd"; API="$NET-api"
cleanup() {
  local rc=$?
  trap - EXIT
  set +e
  for c in "$API" "$RD" "$PG"; do timeout 20 docker rm -f -v "$c" >/dev/null 2>&1; done
  timeout 20 docker network rm "$NET" >/dev/null 2>&1
  rm -rf "$WORK"
  return "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
( umask 077; sed -nE 's/^(NVIDIA_API_KEY|NIM_MODEL|RESEND_API_KEY|EMAIL_APPLY_WEBHOOK_SECRET)=(.*)$/\1=\2/p' "$AISE_DIR/apps/api/.env" | sed -e 's/^\([A-Z_]*\)="\(.*\)"$/\1=\2/' > "$WORK/provider.env" )
grep -q '^NVIDIA_API_KEY=.\+' "$WORK/provider.env" && grep -q '^RESEND_API_KEY=.\+' "$WORK/provider.env" || { echo "STOP: provider keys missing on this host"; exit 1; }
if [ "${JOURNEY_WEBHOOK_CHECK:-}" = 1 ]; then grep -q '^EMAIL_APPLY_WEBHOOK_SECRET=whsec_' "$WORK/provider.env" || { echo "STOP: no real EMAIL_APPLY_WEBHOOK_SECRET on this host"; exit 1; }
else sed -i '/^EMAIL_APPLY_WEBHOOK_SECRET=/d' "$WORK/provider.env"; printf 'EMAIL_APPLY_WEBHOOK_SECRET=whsec_%s\n' "$(printf journey-isolated-not-a-real-endpoint-secret | base64 -w0)" >> "$WORK/provider.env"; fi
vac() { cd "$AISE_DIR" && docker compose exec -T postgres psql -U postgres -d aise -Atc "select row_to_json(t) from (select title, company, description, url from \"Job\" where id = '$1' and status = 'ACTIVE') t"; }
{ printf '['; vac "$J1" | tr -d '\n'; printf ','; vac "$J2" | tr -d '\n'; printf ','; vac "$J3" | tr -d '\n'; printf ']'; } > "$WORK/vacancies.json"
python3 -c "import json,sys; v=json.load(open('$WORK/vacancies.json')); assert len(v)==3 and all(x.get('title') for x in v)" || { echo "STOP: vacancies not found"; exit 1; }
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" --network-alias postgres --memory 400m --tmpfs /var/lib/postgresql/data:rw -e POSTGRES_PASSWORD=journey -e POSTGRES_DB=aise postgres:15-alpine >/dev/null
docker run -d --name "$RD" --network "$NET" --network-alias redis --memory 96m redis:7-alpine >/dev/null
for _ in $(seq 1 40); do docker exec "$PG" pg_isready -U postgres -d aise >/dev/null 2>&1 && break; sleep 1; done; sleep 2
start_api() { # $1 = env file
  docker rm -f "$API" >/dev/null 2>&1 || true
  docker run -d --name "$API" --network "$NET" --memory 900m --env-file "$1" \
    -e DATABASE_URL="postgresql://postgres:journey@postgres:5432/aise?schema=public" -e REDIS_HOST=redis -e REDIS_PORT=6379 -e FRONTEND_URL=http://127.0.0.1:3000 \
    -e SCRAPER_SERVICE_TOKEN=journey-service-token -e MATCHING_SERVICE_URL=http://127.0.0.1:9 -e MATCHING_SERVICE_TOKEN=unused -e GLORRI_SCRAPER_ENABLED=false -e APP_ENV=journey \
    -e PAYMENTS_ENABLED=false -e EXTERNAL_APPLY_LIVE_ENABLED=false -e POSTHOG_API_KEY= -e EMAIL_APPLY_ENABLED=true -e EMAIL_APPLY_TRANSPORT=live \
    -e 'EMAIL_APPLY_FROM=AISE Müraciətlər <applications@aisehr.com>' -e EMAIL_APPLY_RECIPIENT_ALLOWLIST="$TEST_RCPT" -e EMAIL_APPLY_REAL_RECIPIENTS=false -e EMAIL_APPLY_AUTOMATION_ENABLED=false \
    -e DOCUMENT_GENERATION_ENABLED=true -e TAILOR_MAX_CALLS=3 -e TAILOR_DAILY_LIMIT=12 -e TAILOR_AZ_WRITER="${TAILOR_AZ_WRITER:-true}" \
    -e BROWSER_AGENT_ENABLED=true -e BROWSER_AGENT_MIN_GAP_MS=0 -e BROWSER_AGENT_AUTONOMOUS_ENABLED= "$IMAGE" >/dev/null
  docker cp "$DRIVER" "$API:/tmp/driver.js" >/dev/null
}
run_driver() { # $1 = phase
  docker exec -e JOURNEY_PHASE="$1" -e NODE_PATH=/repo/node_modules -e SCRAPER_SERVICE_TOKEN=journey-service-token -e JOURNEY_WEBHOOK_CHECK="${JOURNEY_WEBHOOK_CHECK:-}" \
    -e JOURNEY_TEST_RECIPIENT="$TEST_RCPT" -e JOURNEY_CANDIDATE_EMAIL="$CAND" -e TAILOR_AZ_WRITER="${TAILOR_AZ_WRITER:-true}" -e JOURNEY_VACANCIES_JSON="$(cat "$WORK/vacancies.json")" "$API" node /tmp/driver.js
}
run_phase() {
  local phase="$1" rc
  if run_driver "$phase"; then
    echo "phase $phase exit=0"
  else
    rc=$?
    echo "phase $phase exit=$rc" >&2
    exit "$rc"
  fi
}
start_api "$WORK/provider.env"
echo "== phase A: full journey"; run_phase A
echo "== phase B: provider unavailable"
docker cp "$API:/tmp/journey-state.json" "$WORK/state.json" >/dev/null
sed '/^NVIDIA_API_KEY=/d' "$WORK/provider.env" > "$WORK/provider-nokey.env"
start_api "$WORK/provider-nokey.env"
ready=false
for _ in $(seq 1 60); do
  if docker exec "$API" node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then ready=true; break; fi
  sleep 2
done
[ "$ready" = true ] || { echo 'STOP: phase B API did not become ready' >&2; exit 1; }
docker cp "$WORK/state.json" "$API:/tmp/journey-state.json" >/dev/null
run_phase B
