#!/usr/bin/env bash
#
# Positive and negative tests for scripts/check-backup-evidence.py on synthetic sets in a
# private temp directory (no Docker, no network, no production files):
#
#   scripts/test-backup-evidence.sh
#
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"; chmod 700 "$WORK"; trap 'rm -rf "$WORK"' EXIT
FAILS=0

. "$HERE/backup-fixture.sh"
expect_ok()   { if python3 "$HERE/check-backup-evidence.py" "$1/status.json" "$1" "${3:-120}" >"$WORK/o" 2>&1; then echo "PASS  $2"; else echo "FAIL  $2 (rejected)"; sed 's/^/        /' "$WORK/o"; FAILS=$((FAILS+1)); fi; }
expect_fail() { # dir, description, expected reason fragment
  if python3 "$HERE/check-backup-evidence.py" "$1/status.json" "$1" "${4:-120}" >"$WORK/o" 2>&1; then echo "FAIL  $2 (accepted)"; FAILS=$((FAILS+1));
  elif grep -q -i -- "$3" "$WORK/o"; then echo "PASS  $2 -> rejected ($3)"; else echo "FAIL  $2 rejected for another reason"; sed 's/^/        /' "$WORK/o"; FAILS=$((FAILS+1)); fi; }
fresh() { rm -rf "$WORK/s"; STAMP="$(make_set "$WORK/s" 10)"; }

fresh; expect_ok "$WORK/s" "fresh, complete, consistent set"
fresh; rm "$WORK/s/status.json"; expect_fail "$WORK/s" "no status file" "no status file"
fresh; echo '{not json' > "$WORK/s/status.json"; expect_fail "$WORK/s" "malformed status file" "malformed"
fresh; echo '[1,2]' > "$WORK/s/status.json"; expect_fail "$WORK/s" "status file is not an object" "malformed"
fresh; edit "$WORK/s/status.json" "d.pop('lastBackupStamp')"; expect_fail "$WORK/s" "set cannot be identified" "cannot be identified"
fresh; edit "$WORK/s/status.json" "d['lastBackupStamp']='../../etc'"; expect_fail "$WORK/s" "malformed stamp" "malformed"
fresh; edit "$WORK/s/status.json" "d['lastBackupAt']='yesterday'"; expect_fail "$WORK/s" "unparseable timestamp" "not a valid UTC timestamp"
fresh; edit "$WORK/s/status.json" "d['lastBackupAt']='2999-01-01T00:00:00Z'"; expect_fail "$WORK/s" "future-dated backup" "future"
fresh; edit "$WORK/s/status.json" "d['lastRestoreTestAt']='2999-01-01T00:00:00Z'"; expect_fail "$WORK/s" "future-dated restore test" "future"
rm -rf "$WORK/s"; make_set "$WORK/s" 400 >/dev/null; expect_fail "$WORK/s" "stale backup (400 min, limit 120)" "minutes old"
rm -rf "$WORK/s"; make_set "$WORK/s" 400 >/dev/null; expect_ok "$WORK/s" "same set accepted when the limit is raised" 1000
fresh; edit "$WORK/s/status.json" "d['lastOffhostResult']='FAILED'"; expect_fail "$WORK/s" "failed off-host copy" "not VERIFIED"
fresh; edit "$WORK/s/status.json" "d.pop('lastOffhostResult')"; expect_fail "$WORK/s" "no off-host result" "not VERIFIED"
fresh; edit "$WORK/s/status.json" "d['lastOffhostStamp']='20200101T000000Z'"; expect_fail "$WORK/s" "off-host copy of another set" "different set"
fresh; edit "$WORK/s/status.json" "d['lastRestoreTestResult']='FAILED'"; expect_fail "$WORK/s" "failed restore test" "not PASSED"
fresh; edit "$WORK/s/status.json" "d.pop('lastRestoreTestStamp')"; expect_fail "$WORK/s" "restore test not tied to a set" "different set"
fresh; edit "$WORK/s/status.json" "d['lastRestoreTestStamp']='20200101T000000Z'"; expect_fail "$WORK/s" "restore test of another set" "different set"
fresh; edit "$WORK/s/status.json" "d['lastBackupFailureAt']='2026-10-01T03:10:00Z'"; expect_fail "$WORK/s" "recorded backup failure" "failure is recorded"
fresh; edit "$WORK/s/status.json" "d['lastRestoreTestAt']='2000-01-01T00:00:00Z'"; expect_fail "$WORK/s" "restore test dated before the backup" "before the backup"
fresh; edit "$WORK/s/status.json" "d['lastOffhostCopyAt']='2000-01-01T00:00:00Z'"; expect_fail "$WORK/s" "off-host copy dated before the backup" "before the backup"
fresh; edit "$WORK/s/status.json" "d['lastBackupAt']='2020-01-01T00:00:00Z'"; expect_fail "$WORK/s" "backup time does not match the stamp" "does not match the set's stamp"
fresh; rm "$WORK/s/$STAMP-manifest.txt"; expect_fail "$WORK/s" "manifest missing" "manifest is missing"
fresh; rm "$WORK/s/$STAMP-db.sql.gz.age"; expect_fail "$WORK/s" "database archive missing" "database archive is missing"
fresh; : > "$WORK/s/$STAMP-uploads.tar.gz.age"; expect_fail "$WORK/s" "empty files archive" "files archive is missing or empty"
fresh; printf 'x' >> "$WORK/s/$STAMP-uploads.tar.gz.age"; expect_fail "$WORK/s" "tampered files archive" "does not match the manifest checksum"
fresh; sed -i.bak 's/^stamp:.*/stamp:        20200101T000000Z/' "$WORK/s/$STAMP-manifest.txt"; expect_fail "$WORK/s" "manifest of another set" "different set"
fresh; sed -i.bak "s#^db_archive:.*#db_archive:   ../../x#" "$WORK/s/$STAMP-manifest.txt"; expect_fail "$WORK/s" "manifest points outside the set" "unexpected"
fresh; expect_fail "$WORK/s" "invalid max age" "max age" 0
echo; [ "$FAILS" -eq 0 ] && echo "BACKUP EVIDENCE TESTS PASSED" || echo "BACKUP EVIDENCE TESTS: $FAILS FAILED"
exit $((FAILS>0))
