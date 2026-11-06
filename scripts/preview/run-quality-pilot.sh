#!/usr/bin/env bash
# Runs the small real-provider quality pilot (an Azerbaijani CV, an English resume and an Azerbaijani letter, old prompts versus new) ONLY when the operator
# has supplied provider configuration AND explicitly authorised a spending cap. It never prints a credential, never reads a production env file, and a key
# on its own authorises nothing.
#
#   scripts/preview/run-quality-pilot.sh                       # dry run: shows what is missing and the plan; nothing is called
#   scripts/preview/run-quality-pilot.sh --authorize-requests 18 --authorize-tokens 150000 [--arms=before,after]
#
# Provider configuration: a file OUTSIDE the repository, mode 600, owned by you, default ~/aise-preview/provider.env (override: AISE_PROVIDER_ENV), with lines
#   NVIDIA_API_KEY=...              (required)
#   NIM_MODEL=...                   (optional; the product default otherwise)
#   EVAL_PRICE_IN_PER_MTOK=...      (optional: the provider's published price per million input tokens, in your currency)
#   EVAL_PRICE_OUT_PER_MTOK=...     (optional: per million output tokens; without both, cost is reported as tokens only)
# Only those names are read; the file is parsed, never executed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOME_DIR="${AISE_PREVIEW_HOME:-$HOME/aise-preview}"
ENV_FILE="${AISE_PROVIDER_ENV:-$HOME_DIR/provider.env}"
REQ=""; TOK=""; ARMS="before,after"
while [ $# -gt 0 ]; do
  case "$1" in
    --authorize-requests) REQ="${2:-}"; shift 2 ;;
    --authorize-tokens) TOK="${2:-}"; shift 2 ;;
    --arms=*) ARMS="${1#--arms=}"; shift ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done

problems=()
if [ ! -f "$ENV_FILE" ]; then problems+=("provider configuration file not found: $ENV_FILE (see the header of this script)")
else
  mode="$(stat -f %Lp "$ENV_FILE" 2>/dev/null || stat -c %a "$ENV_FILE")"
  owner="$(stat -f %Su "$ENV_FILE" 2>/dev/null || stat -c %U "$ENV_FILE")"
  [ "$mode" = "600" ] || problems+=("$ENV_FILE must have mode 600 (it has $mode)")
  [ "$owner" = "$(id -un)" ] || problems+=("$ENV_FILE must be owned by you")
  case "$(cd "$(dirname "$ENV_FILE")" && pwd)/" in "$ROOT"/*) problems+=("$ENV_FILE is inside the repository; keep it outside git") ;; esac
  grep -q '^NVIDIA_API_KEY=.\+' "$ENV_FILE" || problems+=("NVIDIA_API_KEY is not set in $ENV_FILE")
fi
if ! [[ "$REQ" =~ ^[0-9]+$ ]] || [ "${REQ:-0}" -lt 1 ]; then problems+=("spending cap not authorised: pass --authorize-requests N (the pilot needs at most 18)"); fi
if ! [[ "$TOK" =~ ^[0-9]+$ ]] || [ "${TOK:-0}" -lt 1 ]; then problems+=("token cap not authorised: pass --authorize-tokens M (the default plan stops at 150000)"); fi

cd "$ROOT/apps/api"
RUN=(npx ts-node -r tsconfig-paths/register --transpile-only test/evals/real-model-documents-eval.ts --pilot "--arms=$ARMS")
if [ ${#problems[@]} -gt 0 ]; then
  echo "Not running. Missing:"; printf ' - %s\n' "${problems[@]}"
  echo; echo "Plan (nothing is called):"; env -u NVIDIA_API_KEY "${RUN[@]}" | head -4
  exit 2
fi

# Export only the allowed names from the file (parsed, not sourced); values are never echoed.
while IFS= read -r line; do
  case "$line" in
    NVIDIA_API_KEY=*|NIM_MODEL=*|EVAL_PRICE_IN_PER_MTOK=*|EVAL_PRICE_OUT_PER_MTOK=*) export "${line%%=*}=${line#*=}" ;;
  esac
done < "$ENV_FILE"
export EVAL_CONFIRM=I-AUTHORIZE-REAL-PROVIDER-CALLS EVAL_MAX_CALLS="$REQ" EVAL_MAX_TOTAL_TOKENS="$TOK"
mkdir -p "$HOME_DIR/evals"
echo "$(date -u +%FT%TZ) pilot authorised by $(id -un): max $REQ requests, $TOK tokens, arms $ARMS" >> "$HOME_DIR/evals/authorizations.log"
"${RUN[@]}" --run
