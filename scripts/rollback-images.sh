#!/usr/bin/env bash
#
# Puts the previous images back (the ones adopt-prebuilt-images.sh kept) and recreates only those services.
#
#   scripts/rollback-images.sh <prev-tag> <service> [<service> ...]
#
# Verifies aise-<service>:pre-<prev-tag> exists, points :latest at exactly that image, then
# `docker compose up -d --no-build --no-deps <services>`. The database is NOT rolled back:
# see docs/release-2026-09-30.md for which rollbacks were actually demonstrated.
#
set -euo pipefail
PREV="${1:?usage: rollback-images.sh <prev-tag> <service> ...}"; shift
[ "$#" -gt 0 ] || { echo "no services named" >&2; exit 2; }
PREFIX="${IMAGE_PREFIX:-aise}"; ALLOWED="${ALLOWED_SERVICES:-api web matching-service}"
COMPOSE="${COMPOSE:-docker compose}"
for svc in "$@"; do
  [[ " $ALLOWED " == *" $svc "* ]] || { echo "$svc is not a rollbackable service" >&2; exit 1; }
  docker image inspect "$PREFIX-$svc:pre-$PREV" >/dev/null 2>&1 || { echo "ROLLBACK REFUSED: $PREFIX-$svc:pre-$PREV does not exist" >&2; exit 1; }
done
for svc in "$@"; do
  docker tag "$(docker image inspect "$PREFIX-$svc:pre-$PREV" --format '{{.Id}}')" "$PREFIX-$svc:latest"
  echo "rolled $svc back to $(docker image inspect "$PREFIX-$svc:latest" --format '{{.Id}}' | cut -c1-19)…"
done
$COMPOSE up -d --no-build --no-deps "$@"
