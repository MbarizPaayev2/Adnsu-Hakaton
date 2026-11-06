#!/usr/bin/env bash
#
# Tests scripts/adopt-prebuilt-images.sh and scripts/rollback-images.sh on tiny throwaway images and a
# two-service throwaway compose project (own name, no ports, nothing shared with production):
#
#   scripts/test-image-adoption.sh
#
# Proves: a wrong/short/unknown ID or wrong CPU is refused before any tag changes; adoption keeps the exact
# previous image, never overwrites a kept one, and recreates ONLY the named service (the other service's
# container keeps its start time and image); rollback restores the exact previous image ID.
#
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"; chmod 700 "$WORK"
export COMPOSE_PROJECT_NAME="aiseadopt$$" IMAGE_PREFIX="aiseadopt$$" ALLOWED_SERVICES="alpha beta"
FAILS=0
ok() { printf 'PASS  %s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS+1)); }
cleanup() { (cd "$WORK" && docker compose down -v --remove-orphans >/dev/null 2>&1); for t in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep "^aiseadopt$$-"); do docker rmi -f "$t" >/dev/null 2>&1; done; docker rmi -f "aiseadopt$$-src:1" "aiseadopt$$-src:2" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT
cd "$WORK"
export LEDGER_FILE="$WORK/.last-deployed-images"

mk() { printf 'FROM alpine\nRUN echo %s > /id\nCMD ["sleep","3600"]\n' "$2" | docker build -q -t "$1" - >/dev/null; docker image inspect "$1" --format '{{.Id}}'; }
OLD_A="$(mk "$IMAGE_PREFIX-alpha:latest" old-a)"; OLD_B="$(mk "$IMAGE_PREFIX-beta:latest" old-b)"
NEW_A="$(mk "$IMAGE_PREFIX-src:1" new-a)"; NEW_B="$(mk "$IMAGE_PREFIX-src:2" new-b)"
cat > docker-compose.yml <<YML
services:
  alpha: { image: $IMAGE_PREFIX-alpha:latest }
  beta:  { image: $IMAGE_PREFIX-beta:latest }
YML
docker compose up -d >/dev/null 2>&1
started() { docker inspect "$COMPOSE_PROJECT_NAME-$1-1" --format '{{.State.StartedAt}}'; }
running_image() { docker inspect "$COMPOSE_PROJECT_NAME-$1-1" --format '{{.Image}}'; }
BEFORE_B_START="$(started beta)"; BEFORE_B_IMG="$(running_image beta)"
tag_id() { docker image inspect "$IMAGE_PREFIX-$1:latest" --format '{{.Id}}'; }

refused() { if "$@" >"$WORK/out" 2>&1; then bad "accepted: $DESC"; else grep -q "REFUSED" "$WORK/out" && ok "refused: $DESC" || { bad "failed without a clear refusal: $DESC"; cat "$WORK/out"; }; fi; }
DESC="unknown image ID" refused "$HERE/adopt-prebuilt-images.sh" rel1 "alpha=sha256:$(printf 'a%.0s' {1..64})"
DESC="short/tag-like ID" refused "$HERE/adopt-prebuilt-images.sh" rel1 "alpha=${NEW_A:7:12}"
DESC="service not allowed (apply-worker style)" refused "$HERE/adopt-prebuilt-images.sh" rel1 "apply-worker=$NEW_A"
EXPECT_ARCH=s390x DESC="wrong CPU architecture" refused "$HERE/adopt-prebuilt-images.sh" rel1 "alpha=$NEW_A"
DESC="the ID that is already :latest" refused "$HERE/adopt-prebuilt-images.sh" rel1 "alpha=$OLD_A"
DESC="second service bad -> first must not be changed either" refused "$HERE/adopt-prebuilt-images.sh" rel1 "alpha=$NEW_A" "beta=sha256:$(printf 'b%.0s' {1..64})"
[ "$(tag_id alpha)" = "$OLD_A" ] && ok "no tag changed by any refusal" || bad "a tag changed during a refusal"

"$HERE/adopt-prebuilt-images.sh" rel1 "alpha=$NEW_A" >"$WORK/out" 2>&1 && ok "adoption of alpha succeeded" || { bad "adoption failed"; cat "$WORK/out"; }
[ "$(tag_id alpha)" = "$NEW_A" ] && ok ":latest is now the named image ID" || bad ":latest not updated"
[ "$(docker image inspect "$IMAGE_PREFIX-alpha:pre-rel1" --format '{{.Id}}')" = "$OLD_A" ] && ok "the exact previous image is kept as pre-rel1" || bad "previous image not kept"
grep -q "alpha previous=$OLD_A" "$LEDGER_FILE" && ok "ledger records previous and new IDs" || bad "ledger missing"
DESC="keeping under an already-used <prev-tag> with a different image" refused "$HERE/adopt-prebuilt-images.sh" rel1 "alpha=$NEW_B"

docker compose up -d --no-build --no-deps alpha >/dev/null 2>&1
[ "$(running_image alpha)" = "$NEW_A" ] && ok "alpha now runs the adopted image" || bad "alpha not recreated with the new image"
[ "$(started beta)" = "$BEFORE_B_START" ] && [ "$(running_image beta)" = "$BEFORE_B_IMG" ] && ok "beta untouched (same container start time and image)" || bad "beta was disturbed"

"$HERE/rollback-images.sh" rel1 alpha >"$WORK/out" 2>&1 && ok "rollback ran" || { bad "rollback failed"; cat "$WORK/out"; }
[ "$(running_image alpha)" = "$OLD_A" ] && ok "rollback restored the exact previous image ID" || bad "rollback did not restore the previous image"
[ "$(started beta)" = "$BEFORE_B_START" ] && ok "beta still untouched after rollback" || bad "beta disturbed by rollback"
"$HERE/rollback-images.sh" nosuch alpha >"$WORK/out" 2>&1 && bad "rollback to a missing tag accepted" || ok "rollback to a missing tag refused"
echo; [ "$FAILS" -eq 0 ] && echo "IMAGE ADOPTION TESTS PASSED" || echo "IMAGE ADOPTION TESTS: $FAILS FAILED"; exit $((FAILS>0))
