#!/usr/bin/env bash
#
# Builds the api of ONE exact commit in its own checkout, for RUNTIME=native rehearsals
# (scripts/rehearse-rollback-compat.sh):
#
#   scripts/prepare-rollback-native.sh <commit> <new-empty-directory>
#   scripts/prepare-rollback-native.sh --remove <directory>          # when done
#
# A detached git worktree at <commit> (so exactly the committed source, nothing uncommitted), a COPY of the
# repository's node_modules (each tree needs its own generated Prisma client: the old and new schemas differ),
# the shared types, the Prisma client for that commit's schema, and the compiled api. Touches nothing else.
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail() { printf 'prepare-rollback-native: %s\n' "$*" >&2; exit 1; }
if [ "${1:-}" = "--remove" ]; then
  DEST="${2:?directory}"; [ -d "$DEST" ] || fail "$DEST does not exist"
  git -C "$ROOT" worktree remove --force "$DEST" && echo "removed $DEST"; exit 0
fi
REF="${1:?commit}"; DEST="${2:?empty directory}"
SHA="$(git -C "$ROOT" rev-parse --verify "$REF^{commit}")" || fail "unknown commit $REF"
[ ! -e "$DEST" ] || fail "$DEST already exists"
[ -d "$ROOT/node_modules" ] || fail "run npm ci in $ROOT first"
git -C "$ROOT" worktree add --detach "$DEST" "$SHA" >/dev/null
cp -a "$ROOT/node_modules" "$DEST/node_modules"
( cd "$DEST" && npm run build --workspace=packages/shared-types >/dev/null \
  && npx prisma generate --schema apps/api/prisma/schema.prisma >/dev/null \
  && cd apps/api && npx nest build ) || fail "the build of $SHA failed"
[ -f "$DEST/apps/api/dist/main.js" ] || fail "no apps/api/dist/main.js after the build"
echo "ready: $DEST is the api at $SHA ($(ls "$DEST/apps/api/prisma/migrations" | grep -cE '^[0-9]') migrations)"
