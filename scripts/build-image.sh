#!/usr/bin/env bash
#
# Builds one AISE image on a SHARED host without starving its other services:
# one throwaway BuildKit container with a memory ceiling and CPU limit, a guard
# that aborts the build under real memory/swap/disk pressure, and a gate run
# inside the finished image before anything is swapped.
#
#   scripts/build-image.sh <matching-service|api|web> <tag>    # tag: e.g. the 40-char release sha
#   PLATFORM=linux/amd64 scripts/build-image.sh matching-service rehearsal   # build for another CPU
#
# Produces aise-<service>:<tag> and does NOT touch running containers, the
# :latest tag, other images, volumes or other projects' build caches. The builder
# and its cache are removed at the end. Needs about 4 GB of free disk.
#
# matching-service: requirements-cpu-lock.txt (no CUDA wheels; the model revision is pinned
# in pipeline.py and fetched at build time over plain HTTPS with bounded retries);
# gate = selftest.py offline inside the image.
# api / web: built from the repository root; web needs apps/web/.env.local holding ONLY
# NEXT_PUBLIC_* values (the build refuses anything else).
#
# Provenance: the image is labelled org.opencontainers.image.revision=<the commit being built>, and the build refuses
# a working tree with uncommitted changes (or one whose commit differs from a 40-character tag), so the label is
# true. scripts/check-image-provenance.sh verifies it later; the api gate also proves the compiled operator scripts
# the release plan runs (backfill, rescoring, location repair) are inside the image.
#
set -uo pipefail
SERVICE="${1:?usage: build-image.sh <matching-service|api|web> <tag>}"
TAG="${2:?usage: build-image.sh <matching-service|api|web> <tag>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${RELEASE_ROOT:-$HERE/..}" && pwd)"   # RELEASE_ROOT: build from another clean checkout (e.g. a worktree of the release sha) with these scripts
IMAGE="aise-$SERVICE:$TAG"
case "$SERVICE" in
  matching-service) CTX="$ROOT/apps/matching-service"; DOCKERFILE="" ;;
  api)              CTX="$ROOT"; DOCKERFILE="$ROOT/apps/api/Dockerfile" ;;
  web)              CTX="$ROOT"; DOCKERFILE="$ROOT/apps/web/Dockerfile" ;;
  *) echo "unknown service $SERVICE (matching-service, api, web; apply-worker is unchanged and is not rebuilt)" >&2; exit 2 ;;
esac
PLATFORM="${PLATFORM:-}"
MEM="${BUILD_MEMORY:-1750m}"         # ceiling for the BuildKit container
CPUS="${BUILD_CPUS:-2}"
MIN_DISK_GB="${MIN_DISK_GB:-6}"          # refuse to start below this much free space on the disk that actually fills up (the HOST disk on a Mac)
ABORT_DISK_GB="${ABORT_DISK_GB:-3}"      # stop a running build when the host disk falls below this
CLEANUP_SECONDS="${CLEANUP_SECONDS:-60}" # each cleanup step is bounded: a hung Docker must never hang the script
MIN_AVAIL_MB="${MIN_AVAIL_MB:-500}"
MIN_SWAP_FREE_MB="${MIN_SWAP_FREE_MB:-200}"
MAX_PSI_FULL="${MAX_PSI_FULL:-10}"   # percent, 10 s average
BUILDER="aise-build-$SERVICE-$$"
REVISION="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"

# Runs a command for at most $1 seconds (macOS has no `timeout`); returns 124 when it had to be killed.
bounded() {
  local secs="$1"; shift
  "$@" & local pid=$!
  ( sleep "$secs"; kill -KILL "$pid" >/dev/null 2>&1 ) & local watcher=$!
  local rc=0; wait "$pid" 2>/dev/null || rc=$?
  { kill "$watcher"; wait "$watcher"; } >/dev/null 2>&1
  [ "$rc" -eq 137 ] && rc=124
  return "$rc"
}

CLEANING=""
fail() { printf 'BUILD ABORTED: %s\n' "$*" >&2; cleanup; exit 1; }
cleanup() {
  [ -n "$CLEANING" ] && return 0
  CLEANING=1
  [ -n "${GUARD_PID:-}" ] && kill "$GUARD_PID" >/dev/null 2>&1
  [ -n "${BUILD_PID:-}" ] && kill "$BUILD_PID" >/dev/null 2>&1
  # Only this run's own builder and its state volume, each bounded; if Docker does not answer, say exactly what is left instead of hanging.
  rc=0; bounded "$CLEANUP_SECONDS" docker buildx rm --force "$BUILDER" >/dev/null 2>&1 || rc=$?; [ "$rc" -eq 124 ] && printf 'CLEANUP INCOMPLETE: builder %s may remain (docker did not answer within %ss)\n' "$BUILDER" "$CLEANUP_SECONDS" >&2
  rc=0; bounded "$CLEANUP_SECONDS" docker volume rm -f "buildx_buildkit_${BUILDER}0_state" >/dev/null 2>&1 || rc=$?; [ "$rc" -eq 124 ] && printf 'CLEANUP INCOMPLETE: volume buildx_buildkit_%s0_state may remain (docker did not answer within %ss)\n' "$BUILDER" "$CLEANUP_SECONDS" >&2
  return 0
}
trap cleanup EXIT
trap 'fail "interrupted"' INT TERM

if [ "$SERVICE" = "web" ]; then
  [ -f "$ROOT/apps/web/.env.local" ] || fail "apps/web/.env.local is missing (it must hold the NEXT_PUBLIC_* values)"
  bad="$(grep -E '^[A-Za-z_]+=' "$ROOT/apps/web/.env.local" | cut -d= -f1 | grep -v '^NEXT_PUBLIC_' || true)"
  [ -z "$bad" ] || fail "apps/web/.env.local holds server variable(s) ($(echo $bad | tr '\n' ' ')); the build needs only NEXT_PUBLIC_*"
fi
docker image inspect "$IMAGE" >/dev/null 2>&1 && fail "$IMAGE already exists; choose a new tag (nothing is overwritten)"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || fail "$ROOT is not a git checkout: the image could not record which commit it was built from"
if [[ "$TAG" =~ ^[0-9a-f]{40}$ ]] && [ "$TAG" != "$REVISION" ]; then fail "the tag is $TAG but the checkout is at $REVISION"; fi
if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then
  [ "${ALLOW_DIRTY_BUILD:-}" = "yes" ] || fail "the working tree has uncommitted changes, so the image would not match commit $REVISION (commit them, or ALLOW_DIRTY_BUILD=yes to label it -dirty; a -dirty image is refused by scripts/check-image-provenance.sh)"
  REVISION="$REVISION-dirty"
fi
DOCKER_ROOT="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
free_gb() { df -Pk "$1" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1024/1024}'; }
# Which disk fills up: the Docker root when it is a directory on THIS machine (a Linux host); otherwise (Docker Desktop on a Mac, where the root lives inside a VM
# whose disk image grows on the host) the host's own disk. Checking /var/lib/docker on a Mac silently checks nothing.
if [ -d "$DOCKER_ROOT" ]; then DISK_PATH="$DOCKER_ROOT"; else DISK_PATH="${HOST_DISK_PATH:-/}"; fi
[ "$(free_gb "$DISK_PATH")" -ge "$MIN_DISK_GB" ] 2>/dev/null || fail "less than ${MIN_DISK_GB} GB free on $DISK_PATH ($(free_gb "$DISK_PATH") GB): not starting"

docker buildx create --name "$BUILDER" --driver docker-container \
  --driver-opt "memory=$MEM" --driver-opt "memory-swap=$MEM" --driver-opt "cpuset-cpus=0-$((CPUS-1))" >/dev/null || fail "could not create the capped builder"
docker buildx inspect "$BUILDER" --bootstrap >/dev/null || fail "builder did not start"
CID="$(docker ps --filter "name=buildx_buildkit_${BUILDER}" --format '{{.ID}}' | head -1)"
echo "builder limits (verified): memory=$(docker inspect "$CID" --format '{{.HostConfig.Memory}}') bytes, cpuset=$(docker inspect "$CID" --format '{{.HostConfig.CpusetCpus}}')"

# Guard (every OS): abort a running build when the disk that fills up drops below ABORT_DISK_GB, and, where the kernel exposes pressure data (the Linux host),
# on real memory/swap pressure. The build process is killed (not just the builder stopped), so nothing keeps writing.
(
  while sleep 5; do
    gb="$(free_gb "$DISK_PATH")"
    if [ "${gb:-99}" -lt "$ABORT_DISK_GB" ]; then echo "GUARD: only ${gb} GB free on $DISK_PATH (limit ${ABORT_DISK_GB}) — stopping the build" >&2; kill "$$" >/dev/null 2>&1; exit 0; fi
    if [ -r /proc/pressure/memory ]; then
      psi="$(awk '/^full/ {split($2,a,"="); print int(a[2])}' /proc/pressure/memory)"
      avail="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"
      swapfree="$(awk '/SwapFree/ {print int($2/1024)}' /proc/meminfo)"
      if [ "${psi:-0}" -gt "$MAX_PSI_FULL" ] || [ "${avail:-9999}" -lt "$MIN_AVAIL_MB" ] || [ "${swapfree:-9999}" -lt "$MIN_SWAP_FREE_MB" ]; then
        echo "GUARD: memory stall ${psi}%, available ${avail} MB, swap free ${swapfree} MB — stopping the build" >&2
        kill "$$" >/dev/null 2>&1; exit 0
      fi
    fi
  done
) &
GUARD_PID=$!
[ -r /proc/pressure/memory ] || echo "note: no /proc/pressure here (not the Linux host) — only the disk guard and the memory/CPU caps apply"

start=$SECONDS
docker buildx build --builder "$BUILDER" ${PLATFORM:+--platform "$PLATFORM"} ${DOCKERFILE:+-f "$DOCKERFILE"} --label "org.opencontainers.image.revision=$REVISION" --label "org.opencontainers.image.title=aise-$SERVICE" --load -t "$IMAGE" "$CTX" &
BUILD_PID=$!
wait "$BUILD_PID" || fail "docker build failed (or the guard stopped it)"
BUILD_PID=""
echo "built $IMAGE in $((SECONDS - start)) s, $(docker image inspect "$IMAGE" --format '{{.Size}}' | awk '{printf "%.2f GB", $1/1e9}')"

# Gate inside the finished image (no network needed).
case "$SERVICE" in
  matching-service)
    docker run --rm ${PLATFORM:+--platform "$PLATFORM"} -e HF_HUB_OFFLINE=1 --memory 1500m "$IMAGE" python selftest.py | tail -3 | grep -q "ALL SELFTESTS PASSED" \
      || fail "selftest failed inside $IMAGE" ;;
  api)
    docker run --rm ${PLATFORM:+--platform "$PLATFORM"} --memory 600m --entrypoint node "$IMAGE" -e "require('@prisma/client'); require('/repo/apps/api/dist/resumes/tailor/resume-tailor.service.js'); console.log('ok')" | grep -q '^ok$' \
      || fail "api image does not load its compiled code"
    for script in backfill-dedup-keys rescore-profiles repair-glorri-locations; do
      docker run --rm ${PLATFORM:+--platform "$PLATFORM"} --network none --entrypoint test "$IMAGE" -f "/repo/apps/api/dist/scripts/$script.js" \
        || fail "api image has no compiled scripts/$script.js (the release plan runs it)"
    done ;;
  web)
    docker run --rm ${PLATFORM:+--platform "$PLATFORM"} --memory 600m --entrypoint sh "$IMAGE" -c 'test -f apps/web/server.js && echo ok' | grep -q '^ok$' \
      || fail "web image has no standalone server" ;;
esac
echo "gate passed inside $IMAGE"
echo "OK: $IMAGE is ready. Swap procedure: docs/release-2026-09-30.md"
