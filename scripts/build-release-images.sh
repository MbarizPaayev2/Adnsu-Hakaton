#!/usr/bin/env bash
#
# Builds the release images one at a time and STOPS at the first problem (never "continues with the next service").
#
#   PLATFORM=linux/amd64 scripts/build-release-images.sh <40-char sha> api web matching-service
#
# Before each service it requires: Docker answers within 15 s, and the disk that fills up (the host disk on a Mac) has MIN_DISK_GB free. A service whose image
# for this sha already exists is reused only if its revision label is exactly this sha; it is never rebuilt over. build-image.sh does the building, aborts a
# running build below ABORT_DISK_GB and cleans up after itself within bounded time. Builds from RELEASE_ROOT (default: the checkout holding this script), which must be a clean checkout of the sha.
set -uo pipefail
SHA="${1:?40-character commit sha}"; shift
[ $# -ge 1 ] || { echo "name at least one service (api web matching-service)" >&2; exit 2; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "not a 40-character sha: $SHA" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
MIN_DISK_GB="${MIN_DISK_GB:-6}"
free_gb() { df -Pk "${HOST_DISK_PATH:-/}" | awk 'NR==2 {printf "%d", $4/1024/1024}'; }
docker_answers() { docker version --format '{{.Server.Version}}' >/dev/null 2>&1 & local p=$!; ( sleep 15; kill -KILL "$p" 2>/dev/null ) & local w=$!; wait "$p" 2>/dev/null; local rc=$?; { kill "$w"; wait "$w"; } 2>/dev/null; return "$rc"; }
RELEASE_ROOT="${RELEASE_ROOT:-$HERE/..}"; export RELEASE_ROOT
[ "$(git -C "$RELEASE_ROOT" rev-parse HEAD)" = "$SHA" ] || { echo "the checkout is not at $SHA" >&2; exit 2; }
for service in "$@"; do
  echo "=== $service: $(date -u +%T) free=$(free_gb) GB"
  docker_answers || { echo "STOP: Docker did not answer within 15 s; nothing was started for $service" >&2; exit 1; }
  [ "$(free_gb)" -ge "$MIN_DISK_GB" ] || { echo "STOP: $(free_gb) GB free, need $MIN_DISK_GB GB; nothing was started for $service" >&2; exit 1; }
  image="aise-$service:$SHA"
  if docker image inspect "$image" >/dev/null 2>&1; then
    rev="$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
    [ "$rev" = "$SHA" ] && { echo "reusing $image (revision label matches)"; continue; }
    echo "STOP: $image exists but is labelled '$rev'" >&2; exit 1
  fi
  "$HERE/build-image.sh" "$service" "$SHA" || { echo "STOP: build of $service failed; later services were not started" >&2; exit 1; }
done
echo "ALL REQUESTED IMAGES READY for $SHA"
