#!/usr/bin/env bash
# Isolated employer publication gate on the production host: throwaway network, tmpfs Postgres, Redis and the RELEASE API image. Never touches production data.
set -euo pipefail
IMAGE="${1:?api image}"; DRIVER="${2:?driver.js}"
avail="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"; [ "$avail" -ge 1200 ] || { echo "STOP: only ${avail} MB available"; exit 1; }
ID="$$"; NET="aiseeg$ID"; PG="$NET-pg"; RD="$NET-rd"; API="$NET-api"
cleanup() { set +e; for c in "$API" "$RD" "$PG"; do timeout 20 docker rm -f -v "$c" >/dev/null 2>&1; done; timeout 20 docker network rm "$NET" >/dev/null 2>&1; }
trap cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" --network-alias postgres --memory 400m --tmpfs /var/lib/postgresql/data:rw -e POSTGRES_PASSWORD=gate -e POSTGRES_DB=aise postgres:15-alpine >/dev/null
docker run -d --name "$RD" --network "$NET" --network-alias redis --memory 96m redis:7-alpine >/dev/null
for _ in $(seq 1 40); do docker exec "$PG" pg_isready -U postgres -d aise >/dev/null 2>&1 && break; sleep 1; done; sleep 2
docker run -d --name "$API" --network "$NET" --memory 900m \
  -e DATABASE_URL="postgresql://postgres:gate@postgres:5432/aise?schema=public" -e REDIS_HOST=redis -e REDIS_PORT=6379 -e FRONTEND_URL=http://127.0.0.1:3000 \
  -e JWT_SECRET=gate-isolated-jwt-secret-not-real-0123456789 -e NEXTAUTH_SECRET=gate-isolated-nextauth-0123456789 \
  -e SCRAPER_SERVICE_TOKEN=gate-service-token -e MATCHING_SERVICE_URL=http://127.0.0.1:9 -e MATCHING_SERVICE_TOKEN=unused -e GLORRI_SCRAPER_ENABLED=false -e APP_ENV=journey \
  -e PAYMENTS_ENABLED=false -e EMPLOYER_PLANS_ENABLED=true -e EMPLOYER_BILLING_ENABLED=false -e EXTERNAL_APPLY_LIVE_ENABLED=false -e POSTHOG_API_KEY= \
  -e EMAIL_APPLY_ENABLED=false -e DOCUMENT_GENERATION_ENABLED=false -e BROWSER_AGENT_ENABLED=false "$IMAGE" >/dev/null
ready=false
for _ in $(seq 1 90); do
  if docker exec "$API" node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then ready=true; break; fi
  sleep 2
done
[ "$ready" = true ] || { echo "STOP: API not ready"; docker logs --tail 30 "$API" 2>&1 | cut -c1-200; exit 1; }
docker cp "$DRIVER" "$API:/tmp/driver.js" >/dev/null
rc=0; docker exec -e NODE_PATH=/repo/node_modules "$API" node /tmp/driver.js || rc=$?
echo "driver exit=$rc"
docker exec "$API" cat /tmp/gate-result.json 2>/dev/null | head -c 6000 || true
exit "$rc"
