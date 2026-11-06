#!/usr/bin/env bash
#
# Runs ONE real-provider document journey on the production host in an ISOLATED throwaway stack (own network, tmpfs Postgres, Redis, and the deployed API image
# with DOCUMENT_GENERATION_ENABLED=true), so the live site, its database and its switch are never touched.
#
#   scripts/run-real-provider-documents-journey.sh <api-image> <job-id-of-a-public-vacancy-in-the-production-db> <driver.js>
#
# The provider key is read from the production env file into a mode-600 temp file on THIS host (only NVIDIA_API_KEY and NIM_MODEL), handed to the throwaway
# container, and deleted on exit; it is never printed or copied elsewhere. The public vacancy (title, company, description, url) is read from the production
# database read-only and used as DATA. Spend is bounded by the product's own limits: at most 3 provider calls per document, TAILOR_DAILY_LIMIT=6 for the
# throwaway account. Containers are memory-capped; the run refuses to start when the host has less than 1400 MB available.
set -uo pipefail
IMAGE="${1:?api image}"; JOB_ID="${2:?job id}"; DRIVER="${3:?driver.js}"
AISE_DIR="${AISE_DIR:-/srv/stacks/aise}"
avail="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"
[ "$avail" -ge 1400 ] || { echo "STOP: only ${avail} MB available (need 1400)"; exit 1; }
WORK="$(umask 077; mktemp -d /tmp/aise-journey.XXXXXX)"; ID="$$"; NET="aisejourney$ID"; PG="$NET-pg"; RD="$NET-rd"; API="$NET-api"
cleanup() { for c in "$API" "$RD" "$PG"; do docker rm -f -v "$c" >/dev/null 2>&1; done; docker network rm "$NET" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT
( umask 077; sed -nE 's/^(NVIDIA_API_KEY|NIM_MODEL)=(.*)$/\1=\2/p' "$AISE_DIR/apps/api/.env" | sed -e 's/^\([A-Z_]*\)="\(.*\)"$/\1=\2/' > "$WORK/provider.env" )
grep -q '^NVIDIA_API_KEY=.\+' "$WORK/provider.env" || { echo "STOP: no provider key configured on this host"; exit 1; }
echo "provider model: $(sed -n 's/^NIM_MODEL=//p' "$WORK/provider.env")"
cd "$AISE_DIR" && docker compose exec -T postgres psql -U postgres -d aise -Atc "select row_to_json(t) from (select title, company, description, url from \"Job\" where id = '$JOB_ID' and status = 'ACTIVE') t" > "$WORK/vacancy.json"
[ -s "$WORK/vacancy.json" ] || { echo "STOP: vacancy not found"; exit 1; }
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" --network-alias postgres --memory 400m --tmpfs /var/lib/postgresql/data:rw -e POSTGRES_PASSWORD=journey -e POSTGRES_DB=aise postgres:15-alpine >/dev/null
docker run -d --name "$RD" --network "$NET" --network-alias redis --memory 96m redis:7-alpine >/dev/null
for _ in $(seq 1 40); do docker exec "$PG" pg_isready -U postgres -d aise >/dev/null 2>&1 && break; sleep 1; done; sleep 2
docker run -d --name "$API" --network "$NET" --memory 900m --env-file "$WORK/provider.env" \
  -e DATABASE_URL="postgresql://postgres:journey@postgres:5432/aise?schema=public" -e REDIS_HOST=redis -e REDIS_PORT=6379 -e FRONTEND_URL=http://127.0.0.1:3000 \
  -e SCRAPER_SERVICE_TOKEN=journey-service-token -e MATCHING_SERVICE_URL=http://127.0.0.1:9 -e MATCHING_SERVICE_TOKEN=unused -e GLORRI_SCRAPER_ENABLED=false -e APP_ENV=journey \
  -e PAYMENTS_ENABLED=false -e EXTERNAL_APPLY_LIVE_ENABLED=false -e POSTHOG_API_KEY= -e RESEND_API_KEY= -e DOCUMENT_GENERATION_ENABLED=true -e TAILOR_MAX_CALLS=3 -e TAILOR_DAILY_LIMIT=6 "$IMAGE" >/dev/null || exit 1
docker cp "$DRIVER" "$API:/tmp/driver.js" >/dev/null
docker exec -e JOURNEY_EMIT_PDF="${JOURNEY_EMIT_PDF:-}" -e NODE_PATH=/repo/node_modules -e SCRAPER_SERVICE_TOKEN=journey-service-token -e JOURNEY_VACANCY_JSON="$(cat "$WORK/vacancy.json")" "$API" node /tmp/driver.js
echo "driver exit=$?"
