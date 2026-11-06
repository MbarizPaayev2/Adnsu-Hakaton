#!/usr/bin/env bash
#
# Tests scripts/check-image-provenance.sh on tiny throwaway images (own names, nothing shared):
#
#   scripts/test-image-provenance.sh
#
# Proves: the right revision and files pass; a different revision, a "-dirty" revision, no label, a missing
# file, a missing image, a short sha and a missing argument are all refused.
#
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ID="$$"; WORK="$(mktemp -d)"; FAILS=0
ok() { printf 'PASS  %s\n' "$*"; }; bad() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS+1)); }
TAGS=(); cleanup() { for t in "${TAGS[@]:-}"; do [ -n "$t" ] && docker rmi -f "$t" >/dev/null 2>&1; done; rm -rf "$WORK"; }
trap cleanup EXIT
SHA="$(printf 'a%.0s' {1..40})"; OTHER="$(printf 'b%.0s' {1..40})"

mk() { # tag, label-or-empty, then files to create
  local tag="aiseprov$ID-$1" label="$2"; shift 2
  { echo "FROM alpine"; [ -n "$label" ] && echo "LABEL org.opencontainers.image.revision=$label"; for f in "$@"; do echo "RUN mkdir -p \$(dirname $f) && echo x > $f"; done; } | docker build -q -t "$tag" - >/dev/null
  TAGS+=("$tag"); echo "$tag"
}
FILES=(/repo/apps/api/dist/scripts/backfill-dedup-keys.js /repo/apps/api/dist/scripts/rescore-profiles.js)
GOOD="$(mk good "$SHA" "${FILES[@]}")"
check() { OUT="$("$HERE/check-image-provenance.sh" "$@" 2>&1)"; RC=$?; }
expect() { local desc="$1" code="$2" pat="${3:-}"; if [ "$RC" -ne "$code" ]; then bad "$desc (exit $RC, wanted $code)"; echo "$OUT" | sed 's/^/      /'; elif [ -n "$pat" ] && ! grep -q -- "$pat" <<<"$OUT"; then bad "$desc (missing: $pat)"; echo "$OUT" | sed 's/^/      /'; else ok "$desc"; fi; }

check "$GOOD" "$SHA" "${FILES[@]}"; expect "right revision and files pass" 0 "contains /repo/apps/api/dist/scripts/rescore-profiles.js"
check "$GOOD" "$OTHER" "${FILES[@]}"; expect "a different revision is refused" 1 "not the expected"
check "$GOOD" "$SHA" /repo/apps/api/dist/scripts/missing.js; expect "a missing file is refused" 1 "does not contain"
check "$(mk dirty "$SHA-dirty" "${FILES[@]}")" "$SHA"; expect "a dirty-tree build is refused" 1 "uncommitted changes"
check "$(mk nolabel "" "${FILES[@]}")" "$SHA"; expect "an image without a revision label is refused" 1 "no revision label"
check "aiseprov$ID-does-not-exist" "$SHA"; expect "a missing image is refused" 1 "does not exist"
check "$GOOD" "${SHA:0:12}"; expect "a short sha is a usage error" 2 "40-character"
check; expect "no arguments is a usage error" 2 "usage"
echo; [ "$FAILS" -eq 0 ] && echo "image provenance tests: all passed" || echo "image provenance tests: $FAILS FAILED"; exit $((FAILS>0))
