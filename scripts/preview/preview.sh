#!/usr/bin/env bash
# Local founder preview of the integrated product (synthetic data). Usage: scripts/preview/preview.sh start|stop|status|seed|credentials
# Runtime files live outside git in $AISE_PREVIEW_HOME (default ~/aise-preview). Stopping keeps the database, uploads and queue namespace.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SELF="$ROOT/scripts/preview/preview.sh"
HOME_DIR="${AISE_PREVIEW_HOME:-$HOME/aise-preview}"
API_DIR="$ROOT/apps/api"
RUN=(npx ts-node -r tsconfig-paths/register --transpile-only)
mkdir -p "$HOME_DIR/logs"; chmod 700 "$HOME_DIR"
pid_alive() { [ -f "$HOME_DIR/preview.pid" ] && kill -0 "$(cat "$HOME_DIR/preview.pid")" 2>/dev/null; }

case "${1:-status}" in
  start)
    if pid_alive; then echo "Preview already running (pid $(cat "$HOME_DIR/preview.pid"))."; exit 0; fi
    rm -f "$HOME_DIR/state.json"
    cd "$API_DIR"
    nohup "${RUN[@]}" test/support/preview-stack.ts >>"$HOME_DIR/logs/stack.log" 2>&1 &
    echo $! >"$HOME_DIR/preview.pid"
    echo -n "Starting"
    for _ in $(seq 1 300); do
      if [ -f "$HOME_DIR/state.json" ] && grep -q '"ready": true' "$HOME_DIR/state.json"; then echo; break; fi
      pid_alive || { echo; echo "Preview exited; see $HOME_DIR/logs/stack.log"; tail -5 "$HOME_DIR/logs/stack.log"; exit 1; }
      echo -n "."; sleep 1
    done
    "$SELF" status
    echo "Seed (idempotent): $SELF seed"
    ;;
  seed)
    cd "$API_DIR"; "${RUN[@]}" test/support/preview-seed.ts 2>&1 | tee -a "$HOME_DIR/logs/seed.log"
    ;;
  stop)
    if pid_alive; then
      kill -TERM "$(cat "$HOME_DIR/preview.pid")"
      for _ in $(seq 1 30); do pid_alive || break; sleep 1; done
      pid_alive && { echo "Still stopping; check $HOME_DIR/logs/stack.log"; exit 1; }
      echo "Stopped. Database, uploads and queue namespace are kept."
    else echo "Not running."; fi
    ;;
  credentials)
    cat "$HOME_DIR/credentials.json" ;;
  status)
    if pid_alive; then
      echo "Running (pid $(cat "$HOME_DIR/preview.pid"))"
      curl -fsS "http://127.0.0.1:4450/health" || echo "control page not answering"; echo
      echo "App http://127.0.0.1:3470 · API http://127.0.0.1:4440 · control http://127.0.0.1:4450"
    else echo "Not running."; fi
    ;;
  *) echo "usage: $0 start|stop|status|seed|credentials"; exit 2 ;;
esac
