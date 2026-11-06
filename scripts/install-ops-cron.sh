#!/usr/bin/env bash
#
# Installs (or removes) the production host's scheduled operations in the DEPLOY USER's crontab, as ONE marked block, idempotently.
# Nothing else in the crontab is touched (other stacks' entries are preserved byte for byte).
#
#   AISE_BACKUP_AGE_RECIPIENT=age1... ALERT_EMAIL_TO=ops@example.com scripts/install-ops-cron.sh            # dry run: prints the block
#   AISE_BACKUP_AGE_RECIPIENT=age1... ALERT_EMAIL_TO=ops@example.com scripts/install-ops-cron.sh --apply    # install/replace
#   SOURCE_ALLOWLIST=glorri,xsolla ... --apply   (optional: sources the health check accepts as scheduled; default glorri only)
#   scripts/install-ops-cron.sh --remove                                                                    # remove the block
#
# Jobs (each under flock -n: a run that is still going makes the next one skip instead of overlapping):
#   03:10 UTC daily   scripts/backup-daily.sh  — encrypted backup, then the off-host copy to the bucket with a byte-for-byte read-back;
#                     the bucket credentials come from ~/.config/aise-backup/r2.env (mode 600), never from this file or the crontab.
#   every 15 minutes  scripts/check-health.sh  — readiness, backup/off-host/restore freshness, disk. E-mail alerts (Resend, noreply@) go out
#                     at most once per ALERT_EMAIL_MIN_HOURS for the same set of problems, plus one recovery mail.
# The restore proof needs the PRIVATE backup key, which never lives on the host; run scripts/mac-verify-backup.sh from the owner's machine
# (and keep a recent PASSED proof, or check-health reports it as stale after MAX_RESTORE_AGE_DAYS).
set -uo pipefail
AISE_DIR="${AISE_DIR:-/srv/stacks/aise}"
DEST="${BACKUP_DIR:-$HOME/aise-backups}"
R2_ENV="${R2_ENV:-$HOME/.config/aise-backup/r2.env}"
BEGIN='# BEGIN aise-ops (managed by scripts/install-ops-cron.sh; do not edit by hand)'
END='# END aise-ops'
MODE="${1:-}"

current="$(crontab -l 2>/dev/null || true)"
without="$(printf '%s\n' "$current" | awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1} !skip{print} $0==e{skip=0}' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"

if [ "$MODE" = "--remove" ]; then
  printf '%s\n' "$without" | crontab - && echo "aise-ops block removed"; exit $?
fi

: "${AISE_BACKUP_AGE_RECIPIENT:?AISE_BACKUP_AGE_RECIPIENT (the PUBLIC age recipient) is required}"
[[ "$AISE_BACKUP_AGE_RECIPIENT" =~ ^age1[a-z0-9]{50,}$ ]] || { echo "AISE_BACKUP_AGE_RECIPIENT is not an age public key" >&2; exit 2; }
: "${ALERT_EMAIL_TO:?ALERT_EMAIL_TO is required}"
[ -f "$R2_ENV" ] && [ "$(stat -c %a "$R2_ENV")" = "600" ] || { echo "$R2_ENV must exist with mode 600" >&2; exit 2; }
for f in backup-daily.sh check-health.sh; do [ -x "$AISE_DIR/scripts/$f" ] || { echo "$AISE_DIR/scripts/$f missing or not executable" >&2; exit 2; }; done
mkdir -p "$DEST" && chmod 700 "$DEST"

BACKUP_MINUTE="${BACKUP_MINUTE:-10}"; BACKUP_HOUR="${BACKUP_HOUR:-3}"
block="$BEGIN
PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
$BACKUP_MINUTE $BACKUP_HOUR * * * /usr/bin/flock -n $DEST/.backup.lock bash -c '. $R2_ENV; AISE_BACKUP_AGE_RECIPIENT=$AISE_BACKUP_AGE_RECIPIENT $AISE_DIR/scripts/backup-daily.sh' >> $DEST/daily.log 2>&1
*/15 * * * * /usr/bin/flock -n $DEST/.health.lock env STATUS_FILE=$DEST/status/status.json ALERT_EMAIL_TO=$ALERT_EMAIL_TO${SOURCE_ALLOWLIST:+ SOURCE_ALLOWLIST=$SOURCE_ALLOWLIST} $AISE_DIR/scripts/check-health.sh >> $DEST/health.log 2>&1
$END"

if [ "$MODE" != "--apply" ]; then printf '%s\n' "$block"; echo "(dry run: nothing installed; add --apply)"; exit 0; fi
{ [ -n "$without" ] && printf '%s\n' "$without"; printf '%s\n' "$block"; } | crontab - || exit 1
echo "installed; crontab now has $(crontab -l | grep -c .) non-empty lines"
