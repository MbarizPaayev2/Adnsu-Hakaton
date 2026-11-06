#!/usr/bin/env bash
#
# Host-side deploy for AISE. Run on the server that hosts the stack, either by
# hand or via .github/workflows/deploy.yml.
#
#   ./scripts/deploy.sh <git-ref>                                  # build mode (default): rebuild SERVICES on this host
#   DEPLOY_MODE=prebuilt PREBUILT_IMAGES="api=sha256:..,web=sha256:.." ./scripts/deploy.sh <git-ref>
#
# What it does, in order: fetch the ref, refuse to run on a dirty tree, record
# the current commit for rollback, rebuild the app images (build mode) or adopt
# the explicitly named, already-built images (prebuilt mode), bring the stack up,
# then health-check. It is safe to re-run.
#
# Prebuilt mode (used on the shared production laptop, images built elsewhere and
# loaded with docker load): nothing is built. Each named image ID must exist here and
# match this host's CPU (scripts/adopt-prebuilt-images.sh); the running image of each
# service is kept as aise-<service>:pre-<previous commit>; then ONLY the named services
# are recreated with `docker compose up -d --no-build --no-deps`. postgres, redis,
# apply-worker and everything else keep running untouched (no --remove-orphans).
# Roll the images back with scripts/rollback-images.sh.
#
# Deliberately NOT here: a `prisma migrate deploy` step. apps/api/Dockerfile's
# CMD already runs migrations before starting the server, so adding one here
# would either duplicate the work or race the container that is also doing it.
#
set -euo pipefail

REF="${1:-main}"
COMPOSE="${COMPOSE:-docker compose}"
# Services rebuilt from this repo. postgres and redis are upstream images and
# matching-service/apply-worker are only rebuilt when asked, since their
# images are expensive (PyTorch, headless browser) and rarely change.
SERVICES="${SERVICES:-api web}"
DEPLOY_MODE="${DEPLOY_MODE:-build}"
PREBUILT_IMAGES="${PREBUILT_IMAGES:-}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mDEPLOY FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# DEPLOY_DIR lets a copy of this script from the NEW release run against the production checkout, which
# still holds the old scripts until this run updates it: git show <sha>:scripts/deploy.sh > /tmp/d.sh
cd "${DEPLOY_DIR:-$(dirname "$0")/..}"
REPO_DIR="$(pwd)"
log "Deploying $REF in $REPO_DIR"

# ---------------------------------------------------------------- preflight --
command -v docker >/dev/null || fail "docker is not installed"
$COMPOSE version >/dev/null 2>&1 || fail "docker compose plugin is not available"

# The compose file interpolates these and aborts with :? if any is unset. They
# live in the host's root .env, which is gitignored and therefore survives the
# reset below.
[ -f .env ] || fail "missing .env in $REPO_DIR (NEXTAUTH_SECRET, MATCHING_SERVICE_TOKEN, APPLY_WORKER_TOKEN)"
[ -f apps/api/.env ] || fail "missing apps/api/.env (compose loads it via env_file)"
# NEXT_PUBLIC_* are inlined into the client bundle at `next build` time, so
# this file has to exist *before* the web image is built, not at runtime.
if [ "$DEPLOY_MODE" = "build" ]; then
  [ -f apps/web/.env.local ] || fail "missing apps/web/.env.local (NEXT_PUBLIC_API_URL is baked in at build time)"
elif [ "$DEPLOY_MODE" = "prebuilt" ]; then
  [ -n "$PREBUILT_IMAGES" ] || fail "DEPLOY_MODE=prebuilt needs PREBUILT_IMAGES=\"api=sha256:<id> web=sha256:<id> ...\" (explicit image IDs)"
else
  fail "DEPLOY_MODE must be build or prebuilt"
fi

# api and web attach to an externally-managed reverse-proxy network.
docker network inspect proxy >/dev/null 2>&1 \
  || fail "docker network 'proxy' does not exist — create it or detach api/web from it in docker-compose.yml"

if [ -n "$(git status --porcelain)" ]; then
  fail "working tree is dirty — commit, stash or discard local changes first (git status)"
fi

# ------------------------------------------------------------------ update --
PREVIOUS="$(git rev-parse HEAD)"
log "Current commit $PREVIOUS (recorded for rollback)"
echo "$PREVIOUS" > .last-deployed-commit

log "Fetching $REF"
git fetch --prune origin || fail "git fetch failed"
git checkout --detach "$REF" 2>/dev/null || git checkout "$REF" || fail "cannot check out $REF"
git reset --hard "$REF" || fail "git reset failed"
TARGET="$(git rev-parse HEAD)"
log "Now at $TARGET"
git --no-pager log --oneline -1

# --------------------------------------------------- schema compatibility --
# A code rollback does NOT roll the database back. If the target lacks
# migrations the previous code shipped, the database stays on the newer
# schema: additive migrations are usually tolerated by older code, but its
# checks (roles, MFA, payment status, receipts) are older too. Make that an
# explicit decision instead of a side effect of "deploy the old ref".
AHEAD="$(comm -23 \
  <(git ls-tree --name-only "$PREVIOUS" apps/api/prisma/migrations/ 2>/dev/null | sort) \
  <(git ls-tree --name-only "$TARGET" apps/api/prisma/migrations/ | sort) || true)"
if [ -n "$AHEAD" ]; then
  printf '\n\033[33mThe database has migrations that %s does not know:\033[0m\n%s\n' "$TARGET" "$AHEAD"
  if [ "${ALLOW_SCHEMA_AHEAD:-}" != "yes" ]; then
    git checkout --detach "$PREVIOUS" >/dev/null 2>&1 || true
    fail "refusing to roll code back behind the database schema. Re-run with ALLOW_SCHEMA_AHEAD=yes after reading docs/release-2026-10-05.md (Rollback)."
  fi
fi

# Release identification shown on /admin/system (RELEASE_SHA in docker-compose.yml).
export RELEASE_SHA="$TARGET"

if [ "$DEPLOY_MODE" = "build" ]; then
  # ----------------------------------------------------------------- build --
  # Built before anything is stopped, so a compile error leaves the running
  # stack untouched.
  log "Building: $SERVICES"
  $COMPOSE build $SERVICES || fail "image build failed — the previous stack is still running, nothing was replaced"
  log "Starting stack"
  # --remove-orphans clears containers for services deleted from the compose file.
  $COMPOSE up -d --remove-orphans || fail "docker compose up failed"
  WAIT_SERVICES="api web"
else
  # --------------------------------------------------------------- prebuilt --
  log "Adopting prebuilt images (nothing is built)"
  # shellcheck disable=SC2086
  "$REPO_DIR/scripts/adopt-prebuilt-images.sh" "${PREVIOUS:0:12}" $PREBUILT_IMAGES || fail "image adoption refused — the running stack is untouched"
  UP_SERVICES="$(for pair in $PREBUILT_IMAGES; do printf '%s ' "${pair%%=*}"; done)"
  log "Recreating only: $UP_SERVICES"
  # shellcheck disable=SC2086
  $COMPOSE up -d --no-build --no-deps $UP_SERVICES || fail "docker compose up failed for: $UP_SERVICES (previous images are kept as :pre-${PREVIOUS:0:12}; scripts/rollback-images.sh ${PREVIOUS:0:12} $UP_SERVICES)"
  WAIT_SERVICES="$UP_SERVICES"
fi

# ------------------------------------------------------------------ health --
wait_for() {
  local name="$1" url="$2" deadline=$((SECONDS + HEALTH_TIMEOUT))
  log "Waiting for $name ($url)"
  until curl -fsS -o /dev/null --max-time 5 "$url"; do
    if [ $SECONDS -ge $deadline ]; then
      printf '\n--- last 60 log lines for %s ---\n' "$name" >&2
      $COMPOSE logs --tail 60 "$name" >&2 || true
      fail "$name did not become healthy within ${HEALTH_TIMEOUT}s"
    fi
    sleep 3
  done
  echo "    $name is up"
}

# The API applies migrations before it starts listening, so a slow first
# response here can just be a long migration — hence the generous timeout.
# /health/ready answers 200 only when the database and Redis answer.
case " $WAIT_SERVICES " in *" api "*) wait_for api "http://127.0.0.1:4000/health/ready" ;; esac
case " $WAIT_SERVICES " in *" web "*) wait_for web "http://127.0.0.1:3000/" ;; esac

log "Deployed $TARGET successfully"
if [ "$DEPLOY_MODE" = "prebuilt" ]; then
  echo "Previous images are kept. Roll back the images with: ./scripts/rollback-images.sh ${PREVIOUS:0:12} $WAIT_SERVICES"
else
  echo "Roll back with: ./scripts/deploy.sh $PREVIOUS"
fi
