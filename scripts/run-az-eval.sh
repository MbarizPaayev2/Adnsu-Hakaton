#!/usr/bin/env bash
#
# BOUNDED real-provider Azerbaijani document evaluation on the production host, in a throwaway container from the deployed API image (no database, no queue,
# no e-mail; the live site is untouched). The provider key is read from the production env file into a mode-600 temp file on THIS host, handed to the
# throwaway container and deleted on exit; it is never printed or copied elsewhere.
#
#   scripts/run-az-eval.sh <api-image> <workdir with fixtures.json, driver.js[, dist.tar]> <models comma-list> [cases] [kinds] [max-requests]
# Output: <workdir>/out/ (results.json and PDFs). dist.tar (optional) overlays the image's compiled code with a locally built dist to evaluate unmerged changes.
set -uo pipefail
IMAGE="${1:?api image}"; WORK="${2:?workdir}"; MODELS="${3:?models}"; CASES="${4:-}"; KINDS="${5:-CV,LETTER}"; MAXREQ="${6:-40}"
AISE_DIR="${AISE_DIR:-/srv/stacks/aise}"
avail="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"; [ "$avail" -ge 1300 ] || { echo "STOP: only ${avail} MB available"; exit 1; }
TMP="$(umask 077; mktemp -d /tmp/aise-azeval.XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
( umask 077; sed -nE 's/^(NVIDIA_API_KEY)=(.*)$/\1=\2/p' "$AISE_DIR/apps/api/.env" | sed -e 's/^\([A-Z_]*\)="\(.*\)"$/\1=\2/' > "$TMP/provider.env" )
grep -q '^NVIDIA_API_KEY=.\+' "$TMP/provider.env" || { echo "STOP: no provider key configured"; exit 1; }
mkdir -p "$WORK/out"; MOUNT=(-v "$WORK:/work:ro" -v "$WORK/out:/out")
if [ -f "$WORK/dist.tar" ]; then mkdir -p "$TMP/dist" && tar -xf "$WORK/dist.tar" -C "$TMP/dist" && MOUNT+=(-v "$TMP/dist:/repo/apps/api/dist:ro"); echo "overlay: local dist"; fi
# Optional evidence-first writer settings (TAILOR_AZ_WRITER, TAILOR_AZ_WRITER_MODELS, TAILOR_AZ_JUDGE_MODEL, ...) are passed through when set by the caller.
EXTRA=(); for v in TAILOR_AZ_WRITER TAILOR_AZ_WRITER_MODELS TAILOR_AZ_JUDGE_MODEL TAILOR_AZ_WRITER_TIMEOUT_MS TAILOR_AZ_WRITER_DEADLINE_MS TAILOR_AZ_WRITER_TRACE_DETAIL; do [ -n "${!v:-}" ] && EXTRA+=(-e "$v=${!v}"); done
docker run --rm --memory 900m --env-file "$TMP/provider.env" "${EXTRA[@]}" -e NODE_PATH=/repo/node_modules -e TAILOR_TIMEOUT_MS="${TAILOR_TIMEOUT_MS:-120000}" -e TAILOR_DEADLINE_MS="${TAILOR_DEADLINE_MS:-300000}" -e TAILOR_MAX_CALLS="${TAILOR_MAX_CALLS:-3}" \
  -e EVAL_MODELS="$MODELS" -e EVAL_CASES="$CASES" -e EVAL_KINDS="$KINDS" -e EVAL_MAX_REQUESTS="$MAXREQ" "${MOUNT[@]}" --entrypoint node "$IMAGE" /work/driver.js
echo "exit=$?"
