#!/usr/bin/env bash
#
# Window gate WITHOUT durable storage: proves one specific production backup set end to end using the
# founder's Mac, and records that proof in the production status file.
#
#   AISE_STATUS_SSH=tefma@100.89.219.95 \
#   AISE_BACKUP_AGE_IDENTITY=~/.config/aise-backup/age.key \
#   SCHEMA_FILE=<schema.prisma of the code that wrote the backup> \
#   scripts/mac-verify-backup.sh [stamp]          # default: the newest set on the host
#
# 1. copies the set (manifest, database and uploads archives) from the host to a private directory here;
# 2. checks both archives against the manifest SHA-256;
# 3. records an off-host copy as VERIFIED, marked as destination `founder-mac-pull`;
# 4. restores the set in disposable containers (scripts/restore-test.sh: no drift, counts equal, files
#    byte-identical, references resolve) and records PASSED or FAILED for THAT stamp.
#
# R2 MODE (an independent verifier that does not depend on a laptop): AISE_SOURCE=r2 AISE_OFFHOST_REMOTE=r2:bucket/daily (+ the rclone credentials of a READ-ONLY bucket token in
# the environment, e.g. sourced from a mode-600 file). Sets are then read from the bucket itself, so the VERIFIED copy is recorded with destination `bucket`.
# The result is still written to the host's status file over SSH (use a dedicated key restricted to the status tool: see docs/restore-verifier-2026-10-07.md).
#
# This is an honest one-off proof for a change window. It is NOT durable storage: a laptop that sleeps
# or is lost is not a backup destination, scripts/check-health.sh keeps alerting while the recorded
# destination is not the bucket, and the daily schedule still needs a real off-host bucket.
# The private key is used here only and never printed or copied to the host.
#
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
SSH_TARGET="${AISE_STATUS_SSH:?AISE_STATUS_SSH is required (user@host)}"
IDENTITY="${AISE_BACKUP_AGE_IDENTITY:-$HOME/.config/aise-backup/age.key}"
REMOTE_DIR="${AISE_REMOTE_BACKUP_DIR:-aise-backups}"          # relative to the remote home
REMOTE_STATUS="${AISE_REMOTE_STATUS_FILE:-/home/tefma/aise-backups/status/status.json}"
REMOTE_TOOL="${AISE_REMOTE_STATUS_TOOL:-/srv/stacks/aise/scripts/status-update.sh}"
LOCAL_DIR="${AISE_LOCAL_OFFHOST_DIR:-$HOME/aise-backups-offhost}"
SSH_KEY="${AISE_STATUS_SSH_KEY:-$HOME/.ssh/aise_production}"
SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
STAMP_RE='^[0-9]{8}T[0-9]{6}Z$'

die() { echo "MAC VERIFY FAILED: $*" >&2; exit 1; }
remote_status() { ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$REMOTE_TOOL --file $REMOTE_STATUS $*"; }
[ -r "$IDENTITY" ] || die "private key not readable at the configured path"

SOURCE="${AISE_SOURCE:-host}"; RCLONE="${RCLONE:-rclone}"
if [ "$SOURCE" = r2 ]; then
  : "${AISE_OFFHOST_REMOTE:?AISE_OFFHOST_REMOTE is required in r2 mode}"; command -v "$RCLONE" >/dev/null || die "rclone is not installed"
  DESTINATION=bucket; NOTE_WHERE="the independent verifier (from the bucket)"
else DESTINATION=founder-mac-pull; NOTE_WHERE="the founder Mac"; fi
stamp="${1:-}"
if [ -z "$stamp" ] && [ "$SOURCE" = r2 ]; then
  stamp="$("$RCLONE" lsf "$AISE_OFFHOST_REMOTE" 2>/dev/null | sed -n 's/-manifest.txt$//p' | sort | tail -n 1)" || die "cannot list the bucket"
elif [ -z "$stamp" ]; then
  stamp="$(ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "ls -1 $REMOTE_DIR | sed -n 's/-manifest.txt\$//p' | sort | tail -n 1")" || die "cannot list the host's backups"
fi
[[ "$stamp" =~ $STAMP_RE ]] || die "not a backup stamp: $stamp"

umask 077; mkdir -p "$LOCAL_DIR"; chmod 700 "$LOCAL_DIR"
for f in "$stamp-manifest.txt" "$stamp-db.sql.gz.age" "$stamp-uploads.tar.gz.age"; do
  if [ "$SOURCE" = r2 ]; then "$RCLONE" copyto "$AISE_OFFHOST_REMOTE/$f" "$LOCAL_DIR/$f" || die "cannot read $f from the bucket"
  else scp -q "${SSH_OPTS[@]}" "$SSH_TARGET:$REMOTE_DIR/$f" "$LOCAL_DIR/$f" || die "cannot copy $f"; fi
  chmod 600 "$LOCAL_DIR/$f"
done
manifest="$LOCAL_DIR/$stamp-manifest.txt"
for kind in db files; do
  name="$(sed -n "s/^${kind}_archive:[[:space:]]*//p" "$manifest")"; want="$(sed -n "s/^${kind}_sha256:[[:space:]]*//p" "$manifest")"
  [ "$name" = "$(basename "$name")" ] && [[ "$name" == "$stamp"* ]] || die "manifest names an unexpected archive"
  got="$(shasum -a 256 "$LOCAL_DIR/$name" | cut -d' ' -f1)"
  [ -n "$want" ] && [ "$want" = "$got" ] || die "$name does not match its manifest checksum after copying"
done
echo "copied and verified set $stamp in $LOCAL_DIR (archives match the manifest)"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
remote_status "lastOffhostCopyAt=$now lastOffhostStamp=$stamp lastOffhostResult=VERIFIED lastOffhostError= lastOffhostDestination=$DESTINATION" || die "could not record the off-host copy"

log="$(mktemp)"; chmod 600 "$log"
if AISE_BACKUP_AGE_IDENTITY="$IDENTITY" STATUS_FILE="" "$SCRIPT_DIR/restore-test.sh" "$LOCAL_DIR/$stamp-db.sql.gz.age" "$LOCAL_DIR/$stamp-uploads.tar.gz.age" >"$log" 2>&1 \
   && grep -q "RESTORE TEST PASSED" "$log"; then
  secs="$(sed -n 's/.*RESTORE TEST PASSED in \([0-9]*\)s.*/\1/p' "$log" | tail -n 1)"
  remote_status "lastRestoreTestAt=$(date -u +%Y-%m-%dT%H:%M:%SZ) lastRestoreTestResult=PASSED lastRestoreTestStamp=$stamp lastRestoreTestNote='set $stamp restored in ${secs:-?}s on $NOTE_WHERE'" || die "restore passed but could not be recorded"
  echo "RESTORE TEST PASSED for $stamp (${secs:-?}s); recorded on the host"; rm -f "$log"
else
  tail -n 8 "$log" >&2; rm -f "$log"
  remote_status "lastRestoreTestAt=$(date -u +%Y-%m-%dT%H:%M:%SZ) lastRestoreTestResult=FAILED lastRestoreTestStamp=$stamp lastRestoreTestNote='restore of set $stamp failed'" || true
  die "restore of set $stamp failed"
fi
