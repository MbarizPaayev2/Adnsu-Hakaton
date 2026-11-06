#!/usr/bin/env python3
"""Proves that ONE identifiable backup set is safe to rely on before a risky change.

    check-backup-evidence.py <status.json> <backup-dir> [max-age-minutes]

Exit 0 only when every link of the chain belongs to the same set (the stamp in the
archive names) and is consistent:
  - the set's archives and manifest exist locally, and each archive hashes to the value the manifest recorded;
  - the status file names that stamp as the last backup, with no recorded failure;
  - a verified off-host copy of that same stamp is recorded (result VERIFIED);
  - a PASSED restore test of that same stamp is recorded, made after the backup;
  - every timestamp parses, none is in the future, the set is not older than the limit (default 120 min),
    and the order is backup <= off-host copy, backup <= restore test.
Anything missing, malformed, future-dated, stale, mismatched or failed is a rejection with a reason.
Prints reasons and stamps only; never file contents, keys or paths beyond the set's names.
"""
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

STAMP_RE = re.compile(r"^\d{8}T\d{6}Z$")
SKEW = timedelta(seconds=120)


def parse_ts(value, name, problems):
    if not isinstance(value, str):
        problems.append("%s is missing" % name)
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        problems.append("%s is not a valid UTC timestamp" % name)
        return None


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main(argv):
    if len(argv) < 3:
        print("usage: check-backup-evidence.py <status.json> <backup-dir> [max-age-minutes]", file=sys.stderr)
        return 2
    status_path, backup_dir = argv[1], argv[2]
    try:
        max_age = int(argv[3]) if len(argv) > 3 else 120
        if max_age < 1 or max_age > 10080:
            raise ValueError
    except ValueError:
        print("BACKUP EVIDENCE REJECTED: max age must be whole minutes between 1 and 10080", file=sys.stderr)
        return 2
    now = datetime.now(timezone.utc)
    problems = []

    try:
        with open(status_path, encoding="utf-8") as fh:
            status = json.load(fh)
        if not isinstance(status, dict):
            raise ValueError("not an object")
    except FileNotFoundError:
        print("BACKUP EVIDENCE REJECTED: no status file", file=sys.stderr)
        return 1
    except (ValueError, OSError):
        print("BACKUP EVIDENCE REJECTED: the status file is malformed", file=sys.stderr)
        return 1

    stamp = status.get("lastBackupStamp")
    if not isinstance(stamp, str) or not STAMP_RE.match(stamp):
        problems.append("lastBackupStamp is missing or malformed (this backup set cannot be identified)")
        stamp = None

    backup_at = parse_ts(status.get("lastBackupAt"), "lastBackupAt", problems)
    offhost_at = parse_ts(status.get("lastOffhostCopyAt"), "lastOffhostCopyAt", problems)
    restore_at = parse_ts(status.get("lastRestoreTestAt"), "lastRestoreTestAt", problems)

    if status.get("lastBackupFailureAt"):
        problems.append("a backup failure is recorded (%s)" % status.get("lastBackupFailureAt"))
    if status.get("lastOffhostResult") != "VERIFIED":
        problems.append("off-host copy is not VERIFIED (result: %s)" % (status.get("lastOffhostResult") or "none"))
    if stamp and status.get("lastOffhostStamp") != stamp:
        problems.append("the verified off-host copy is of a different set (%s, not %s)" % (status.get("lastOffhostStamp") or "none", stamp))
    if status.get("lastRestoreTestResult") != "PASSED":
        problems.append("restore test is not PASSED (result: %s)" % (status.get("lastRestoreTestResult") or "none"))
    if stamp and status.get("lastRestoreTestStamp") != stamp:
        problems.append("the restore test is of a different set (%s, not %s)" % (status.get("lastRestoreTestStamp") or "none", stamp))

    for label, at in (("lastBackupAt", backup_at), ("lastOffhostCopyAt", offhost_at), ("lastRestoreTestAt", restore_at)):
        if at and at > now + SKEW:
            problems.append("%s is in the future" % label)
    if backup_at and now - backup_at > timedelta(minutes=max_age):
        problems.append("the backup is %d minutes old (limit %d)" % ((now - backup_at).total_seconds() // 60, max_age))
    if backup_at and offhost_at and offhost_at + SKEW < backup_at:
        problems.append("the off-host copy is recorded before the backup it claims to copy")
    if backup_at and restore_at and restore_at + SKEW < backup_at:
        problems.append("the restore test is recorded before the backup it claims to test")
    if stamp and backup_at:
        stamped = datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        if abs(stamped - backup_at) > timedelta(minutes=15):
            problems.append("lastBackupAt does not match the set's stamp")

    if stamp:
        manifest_path = os.path.join(backup_dir, "%s-manifest.txt" % stamp)
        fields = {}
        try:
            with open(manifest_path, encoding="utf-8") as fh:
                for line in fh:
                    m = re.match(r"^(stamp|db_archive|db_sha256|files_archive|files_sha256):\s*(\S+)\s*$", line)
                    if m:
                        fields[m.group(1)] = m.group(2)
        except OSError:
            problems.append("the set's manifest is missing locally")
        if fields:
            if fields.get("stamp") != stamp:
                problems.append("the manifest belongs to a different set")
            for kind, label in (("db", "database"), ("files", "files")):
                name, want = fields.get("%s_archive" % kind), fields.get("%s_sha256" % kind)
                if not name or not want:
                    problems.append("the manifest does not describe the %s archive" % label)
                    continue
                if os.path.basename(name) != name or not name.startswith(stamp):
                    problems.append("the manifest names an unexpected %s archive" % label)
                    continue
                path = os.path.join(backup_dir, name)
                if not os.path.isfile(path) or os.path.getsize(path) == 0:
                    problems.append("the %s archive is missing or empty" % label)
                elif sha256(path) != want:
                    problems.append("the %s archive does not match the manifest checksum" % label)
        elif not any("manifest" in p for p in problems):
            problems.append("the manifest records nothing usable")

    if problems:
        print("BACKUP EVIDENCE REJECTED%s:" % (" for set %s" % stamp if stamp else ""), file=sys.stderr)
        for p in problems:
            print("  - %s" % p, file=sys.stderr)
        return 1
    print("backup evidence OK for set %s: archives match the manifest, off-host copy VERIFIED, restore test PASSED" % stamp)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
