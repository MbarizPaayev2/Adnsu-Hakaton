#!/usr/bin/env bash
#
# Copies encrypted backup sets to durable off-host storage and PROVES each copy.
#
#   AISE_OFFHOST_REMOTE=r2:aise-prod-backups/daily scripts/offhost-sync.sh [backup-dir]
#   AISE_OFFHOST_REMOTE=... scripts/offhost-sync.sh --selftest
#
# Uses rclone against any S3-compatible bucket (Cloudflare R2, Backblaze B2, ...)
# configured with a bucket-scoped key that can write and read but NOT delete.
# Retention is the bucket's lifecycle rule, never this host: a compromised or
# mistaken host cannot erase its own off-host history.
#
# A set (manifest + db + uploads) counts as copied only when every file in the
# bucket hashes (SHA-256, read back from the bucket) to exactly the value the
# backup manifest recorded. A zero exit from the uploader alone proves nothing.
# Only encrypted archives and the manifest (random file names, row counts, no
# personal data) leave this host; the private key is never here.
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RCLONE="${RCLONE:-rclone}"
REMOTE="${AISE_OFFHOST_REMOTE:-}"
RECENT_SETS="${OFFHOST_RECENT_SETS:-3}"

fail() { printf 'OFFHOST FAILED: %s\n' "$*" >&2; exit 1; }
info() { printf '    %s\n' "$*"; }
sha256_of() { shasum -a 256 | cut -d' ' -f1; }

[ -n "$REMOTE" ] || fail "AISE_OFFHOST_REMOTE is not set (example: r2:aise-prod-backups/daily)"
command -v "$RCLONE" >/dev/null || fail "rclone is not installed"

if [ "${1:-}" = "--selftest" ]; then
  # Proves credentials and permissions without touching real backups.
  probe="selftest-$(date -u +%Y%m%dT%H%M%SZ)-$$.txt"
  body="aise offhost selftest $(date -u +%s)"
  printf '%s' "$body" | "$RCLONE" rcat "$REMOTE/$probe" || fail "cannot write to $REMOTE"
  back="$("$RCLONE" cat "$REMOTE/$probe")" || fail "cannot read back from $REMOTE"
  [ "$back" = "$body" ] || fail "read-back differs from what was written"
  if "$RCLONE" deletefile "$REMOTE/$probe" >/dev/null 2>&1; then
    echo "WARNING: this key CAN delete objects. Use a key without delete permission so the host cannot erase its own off-host history." >&2
    echo "selftest passed (write + read-back), but the key is too powerful"
    exit 3
  fi
  echo "selftest passed: write and read-back work, delete is refused (as intended). Leftover probe: $probe"
  exit 0
fi

DEST="${1:-${BACKUP_DIR:-$HOME/aise-backups}}"
STATUS_FILE="${STATUS_FILE:-$DEST/status/status.json}"
[ -d "$DEST" ] || fail "backup directory $DEST does not exist"

# Newest manifests first; only sets whose manifest names both archives.
MANIFESTS=()
while IFS= read -r line; do MANIFESTS+=("$line"); done < <(ls -1 "$DEST"/*-manifest.txt 2>/dev/null | sort -r | head -n "$RECENT_SETS")
[ "${#MANIFESTS[@]}" -gt 0 ] || fail "no backup manifest found in $DEST"

NEWEST_OK=""
for manifest in "${MANIFESTS[@]}"; do
  stamp="$(sed -n 's/^stamp: *//p' "$manifest")"
  db="$(sed -n 's/^db_archive: *//p' "$manifest")"
  files="$(sed -n 's/^files_archive:[[:space:]]*//p' "$manifest")"
  db_sha="$(sed -n 's/^db_sha256: *//p' "$manifest")"
  files_sha="$(sed -n 's/^files_sha256: *//p' "$manifest")"
  [ -n "$stamp" ] && [ -n "$db" ] && [ -n "$files" ] && [ -n "$db_sha" ] && [ -n "$files_sha" ] || fail "manifest $manifest is incomplete"

  for pair in "$db:$db_sha" "$files:$files_sha" "$(basename "$manifest"):"; do
    name="${pair%%:*}"; want="${pair#*:}"
    [ -f "$DEST/$name" ] || fail "$name named by the manifest is missing locally"
    local_sha="$(sha256_of < "$DEST/$name")"
    [ -z "$want" ] || [ "$local_sha" = "$want" ] || fail "$name no longer matches its manifest checksum (local corruption) — not copying it"
    # Already in the bucket with the same content? Then nothing to do.
    remote_sha="$("$RCLONE" cat "$REMOTE/$name" 2>/dev/null | sha256_of || true)"
    if [ "$remote_sha" != "$local_sha" ]; then
      "$RCLONE" copyto "$DEST/$name" "$REMOTE/$name" --s3-no-check-bucket --immutable 2>/dev/null \
        || "$RCLONE" copyto "$DEST/$name" "$REMOTE/$name" --immutable \
        || fail "upload of $name failed"
      remote_sha="$("$RCLONE" cat "$REMOTE/$name" | sha256_of)" || fail "cannot read $name back from the bucket"
    fi
    [ "$remote_sha" = "$local_sha" ] || fail "$name in the bucket does not hash to the local file"
    info "verified in bucket: $name"
  done
  [ -n "$NEWEST_OK" ] || NEWEST_OK="$stamp"
done

"$SCRIPT_DIR/status-update.sh" --file "$STATUS_FILE" \
  lastOffhostCopyAt="$(date -u +%Y-%m-%dT%H:%M:%SZ)" lastOffhostStamp="$NEWEST_OK" lastOffhostResult=VERIFIED lastOffhostError= lastOffhostDestination=bucket \
  || fail "copies verified but the status file could not be written"
echo "off-host copy verified for $NEWEST_OK (and up to $((${#MANIFESTS[@]} - 1)) earlier set(s))"
