#!/usr/bin/env bash
#
# Proves a built image is the one intended: it was built from the expected commit and it contains the files the
# release plan will run.
#
#   scripts/check-image-provenance.sh <image id or reference> <40-char commit sha> [path-inside-image ...]
#
# Images built with scripts/build-image.sh carry the commit they were built from in the standard
# org.opencontainers.image.revision label (and the build refuses a dirty working tree, so the label is true). An
# image without that label, with a different one, or with "-dirty" appended is refused: an image id alone says
# nothing about which source it holds, and an older image will not contain later fixes or scripts.
#
# Read-only: it inspects the image and runs `test -f` in a throwaway container with no network. Exit 0 only when
# every check passed; 1 when any failed; 2 on a usage error.
#
set -uo pipefail
IMAGE="${1:-}"; SHA="${2:-}"; shift 2 2>/dev/null || true
[ -n "$IMAGE" ] || { echo "usage: check-image-provenance.sh <image> <40-char sha> [path ...]" >&2; exit 2; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "check-image-provenance: the expected commit must be the full 40-character sha" >&2; exit 2; }
FAILS=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS+1)); }

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  fail "image $IMAGE does not exist on this host"
  exit 1
fi
rev="$(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null)"
if [ -z "$rev" ]; then
  fail "$IMAGE carries no revision label: it was not built by scripts/build-image.sh at this release, so its source is unknown (rebuild it)"
elif [ "$rev" = "$SHA" ]; then
  pass "$IMAGE was built from $SHA"
elif [ "$rev" = "$SHA-dirty" ]; then
  fail "$IMAGE was built from $SHA with uncommitted changes (label '$rev')"
else
  fail "$IMAGE was built from ${rev:0:40}, not the expected $SHA"
fi
for path in "$@"; do
  if docker run --rm --network none --entrypoint test "$IMAGE" -f "$path" >/dev/null 2>&1; then
    pass "$IMAGE contains $path"
  else
    fail "$IMAGE does not contain $path"
  fi
done
[ "$FAILS" -eq 0 ]
