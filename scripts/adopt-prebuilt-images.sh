#!/usr/bin/env bash
#
# Makes explicitly named, already-built images the ones compose will run — after proving them.
#
#   scripts/adopt-prebuilt-images.sh <prev-tag> api=sha256:<id> web=sha256:<id> [matching-service=sha256:<id>]
#
# For each service: the image with that exact ID must exist locally, must be built for this
# host's CPU, and must not already be the running one. The image currently tagged
# aise-<service>:latest is kept under aise-<service>:pre-<prev-tag> (never overwritten with a
# different image) and recorded in .last-deployed-images; then the new ID is tagged
# aise-<service>:latest. Nothing is built, started, stopped or removed. Deploy afterwards with
# `docker compose up -d --no-build --no-deps <services>` (scripts/deploy.sh does this).
# Only api, web and matching-service are accepted; apply-worker and the stock images are never touched.
#
set -euo pipefail
PREV="${1:?usage: adopt-prebuilt-images.sh <prev-tag> service=image-id ...}"; shift
[ "$#" -gt 0 ] || { echo "no images named" >&2; exit 2; }
[[ "$PREV" =~ ^[A-Za-z0-9._-]{1,40}$ ]] || { echo "bad <prev-tag>" >&2; exit 2; }
PROJECT_IMAGE_PREFIX="${IMAGE_PREFIX:-aise}"
ALLOWED="${ALLOWED_SERVICES:-api web matching-service}"
case "$(docker info --format '{{.Architecture}}')" in x86_64|amd64) HOST_ARCH=amd64 ;; aarch64|arm64) HOST_ARCH=arm64 ;; *) HOST_ARCH="$(docker info --format '{{.Architecture}}')" ;; esac
EXPECT_ARCH="${EXPECT_ARCH:-$HOST_ARCH}"
LEDGER="${LEDGER_FILE:-.last-deployed-images}"
fail() { printf 'ADOPTION REFUSED: %s\n' "$*" >&2; exit 1; }

# Validate everything before changing any tag.
declare -a SVCS IDS
for pair in "$@"; do
  svc="${pair%%=*}"; id="${pair#*=}"
  [[ " $ALLOWED " == *" $svc "* ]] || fail "$svc is not an adoptable service ($ALLOWED)"
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "$svc: '$id' is not a full image ID (sha256:<64 hex>)"
  docker image inspect "$id" >/dev/null 2>&1 || fail "$svc: no image with ID $id on this host (load it first)"
  arch="$(docker image inspect "$id" --format '{{.Architecture}}')"
  [ "$arch" = "$EXPECT_ARCH" ] || fail "$svc: image is built for $arch, this host needs $EXPECT_ARCH"
  current="$(docker image inspect "$PROJECT_IMAGE_PREFIX-$svc:latest" --format '{{.Id}}' 2>/dev/null || true)"
  [ "$current" != "$id" ] || fail "$svc: $id is already the :latest image"
  if docker image inspect "$PROJECT_IMAGE_PREFIX-$svc:pre-$PREV" >/dev/null 2>&1; then
    kept="$(docker image inspect "$PROJECT_IMAGE_PREFIX-$svc:pre-$PREV" --format '{{.Id}}')"
    [ -z "$current" ] || [ "$kept" = "$current" ] || fail "$svc: $PROJECT_IMAGE_PREFIX-$svc:pre-$PREV already holds a different image; choose another <prev-tag>"
  fi
  SVCS+=("$svc"); IDS+=("$id")
done

: > "$LEDGER.tmp"
for i in "${!SVCS[@]}"; do
  svc="${SVCS[$i]}"; id="${IDS[$i]}"
  current="$(docker image inspect "$PROJECT_IMAGE_PREFIX-$svc:latest" --format '{{.Id}}' 2>/dev/null || true)"
  if [ -n "$current" ]; then
    docker tag "$current" "$PROJECT_IMAGE_PREFIX-$svc:pre-$PREV"
    echo "$svc previous=$current kept-as=$PROJECT_IMAGE_PREFIX-$svc:pre-$PREV new=$id" >> "$LEDGER.tmp"
  else
    echo "$svc previous=none new=$id" >> "$LEDGER.tmp"
  fi
  docker tag "$id" "$PROJECT_IMAGE_PREFIX-$svc:latest"
  echo "adopted $svc: ${id:0:19}… (arch $EXPECT_ARCH); previous ${current:0:19}… kept as pre-$PREV"
done
mv "$LEDGER.tmp" "$LEDGER"; chmod 600 "$LEDGER"
