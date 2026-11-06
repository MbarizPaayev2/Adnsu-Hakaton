#!/usr/bin/env bash
#
# Daily job for the production host: encrypted backup, then a verified off-host
# copy. Records success or failure in the status file so /admin/system and
# scripts/check-health.sh show the truth, and exits non-zero on any failure.
#
#   10 3 * * * AISE_BACKUP_AGE_RECIPIENT=age1... AISE_OFFHOST_REMOTE=r2:bucket/daily \
#       /srv/stacks/aise/scripts/backup-daily.sh >> ~/aise-backups/daily.log 2>&1
#
# Logs contain paths, counts and exit states only — never keys or data.
#
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"
DEST="${BACKUP_DIR:-$HOME/aise-backups}"
export STATUS_FILE="${STATUS_FILE:-$DEST/status/status.json}"

stage_fail() { # $1 stage
  "$SCRIPT_DIR/status-update.sh" --file "$STATUS_FILE" \
    lastBackupFailureAt="$(date -u +%Y-%m-%dT%H:%M:%SZ)" lastBackupError="$1 failed; see $DEST/daily.log" >/dev/null 2>&1 || true
  echo "$(date -u +%FT%TZ) DAILY BACKUP FAILED at stage: $1" >&2
  exit 1
}

echo "$(date -u +%FT%TZ) daily backup start"
"$SCRIPT_DIR/backup.sh" "$DEST" || stage_fail "backup"
if [ -n "${AISE_OFFHOST_REMOTE:-}" ]; then
  "$SCRIPT_DIR/offhost-sync.sh" "$DEST" || {
    "$SCRIPT_DIR/status-update.sh" --file "$STATUS_FILE" lastOffhostResult=FAILED lastOffhostError="off-host copy failed" >/dev/null 2>&1 || true
    stage_fail "off-host copy"
  }
else
  echo "AISE_OFFHOST_REMOTE is not set: this backup exists only on this host" >&2
  stage_fail "off-host copy (not configured)"
fi
"$SCRIPT_DIR/status-update.sh" --file "$STATUS_FILE" lastBackupFailureAt= lastBackupError= >/dev/null 2>&1 || true
echo "$(date -u +%FT%TZ) daily backup complete"
