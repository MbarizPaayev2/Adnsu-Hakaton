#!/usr/bin/env bash
#
# Weekly proof that the newest OFF-HOST backup actually restores. Runs where the
# private age key lives (the founder's Mac via launchd — see ops/launchd/), never
# on the production host. The Mac is only the tester: the backups themselves
# sit in the bucket, so a sleeping Mac loses nothing; a missed week shows up as
# an alert (restore test older than the limit in check-health.sh).
#
#   AISE_OFFHOST_REMOTE=r2:aise-prod-backups/daily \
#   AISE_BACKUP_AGE_IDENTITY=~/.config/aise-backup/age.key \
#   AISE_STATUS_SSH=tefma@100.89.219.95 scripts/weekly-restore-test.sh
#
# Steps: download the newest set from the bucket -> check each archive against
# the manifest SHA-256 -> scripts/restore-test.sh (disposable containers; it
# fails if comparison evidence is missing) -> write PASSED/FAILED into the
# production status file over SSH. The key is never printed or copied.
#
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
RCLONE="${RCLONE:-rclone}"
REMOTE="${AISE_OFFHOST_REMOTE:?AISE_OFFHOST_REMOTE is required}"
IDENTITY="${AISE_BACKUP_AGE_IDENTITY:-$HOME/.config/aise-backup/age.key}"
SSH_TARGET="${AISE_STATUS_SSH:-}"
REMOTE_STATUS="${AISE_REMOTE_STATUS_FILE:-/home/tefma/aise-backups/status/status.json}"
REMOTE_TOOL="${AISE_REMOTE_STATUS_TOOL:-/srv/stacks/aise/scripts/status-update.sh}"
SSH_OPTS=(-i "${AISE_STATUS_SSH_KEY:-$HOME/.ssh/aise_production}" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15)

WORK="$(mktemp -d)"; chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
publish() { # PASSED|FAILED, note
  local result="$1" note="${2:-}" now; now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ -n "$SSH_TARGET" ]; then
    ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$REMOTE_TOOL --file $REMOTE_STATUS lastRestoreTestAt=$now lastRestoreTestResult=$result lastRestoreTestStamp=${STAMP_FOR_STATUS:-} lastRestoreTestNote='${note//\'/}'" \
      || echo "WARNING: could not publish the result to $SSH_TARGET" >&2
  fi
}
die() { echo "RESTORE TEST FAILED: $*" >&2; publish FAILED "$*"; exit 1; }

[ -r "$IDENTITY" ] || die "private key not readable at the configured path"
command -v "$RCLONE" >/dev/null || die "rclone is not installed"

# AISE_RESTORE_STAMP pins the exact set to prove (used right before a risky change); default: the newest.
if [ -n "${AISE_RESTORE_STAMP:-}" ]; then
  [[ "$AISE_RESTORE_STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "AISE_RESTORE_STAMP is not a backup stamp"
  newest="$AISE_RESTORE_STAMP-manifest.txt"
else
  newest="$("$RCLONE" lsf "$REMOTE" --include '*-manifest.txt' 2>/dev/null | sort | tail -n 1)"
fi
[ -n "$newest" ] || die "no backup manifest in the bucket"
stamp="${newest%-manifest.txt}"
STAMP_FOR_STATUS="$stamp"
"$RCLONE" copyto "$REMOTE/$newest" "$WORK/$newest" || die "cannot download $newest"
db="$(sed -n 's/^db_archive: *//p' "$WORK/$newest")"; files="$(sed -n 's/^files_archive:[[:space:]]*//p' "$WORK/$newest")"
[ -n "$db" ] && [ -n "$files" ] || die "manifest of $stamp is incomplete"
for name in "$db" "$files"; do
  "$RCLONE" copyto "$REMOTE/$name" "$WORK/$name" || die "cannot download $name"
  want="$(sed -n "s/^$([ "$name" = "$db" ] && echo db || echo files)_sha256: *//p" "$WORK/$newest")"
  got="$(shasum -a 256 "$WORK/$name" | cut -d' ' -f1)"
  [ -n "$want" ] && [ "$want" = "$got" ] || die "$name from the bucket does not match the manifest checksum"
done

log="$WORK/restore.log"
if AISE_BACKUP_AGE_IDENTITY="$IDENTITY" STATUS_FILE="$WORK/status/status.json" \
   "$SCRIPT_DIR/restore-test.sh" "$WORK/$db" "$WORK/$files" >"$log" 2>&1; then
  grep -q "RESTORE TEST PASSED" "$log" || die "restore-test exited 0 without printing its pass line"
  secs="$(sed -n 's/.*RESTORE TEST PASSED in \([0-9]*\)s.*/\1/p' "$log" | tail -n 1)"
  publish PASSED "set $stamp restored in ${secs:-?}s"
  echo "RESTORE TEST PASSED for $stamp (${secs:-?}s)"
else
  tail -n 5 "$log" >&2
  die "restore of set $stamp failed (last lines above)"
fi
