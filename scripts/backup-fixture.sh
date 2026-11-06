# Sourced by the tests and rehearsals: builds synthetic backup sets. Synthetic bytes only.
# make_set <dir> <stamp-offset-minutes-ago>  -> prints the stamp; writes archives + manifest + good status
make_set() {
  python3 - "$1" "$2" <<'PY'
import hashlib, json, os, sys
from datetime import datetime, timedelta, timezone
d, ago = sys.argv[1], int(sys.argv[2])
os.makedirs(d, exist_ok=True)
at = datetime.now(timezone.utc) - timedelta(minutes=ago)
stamp = at.strftime("%Y%m%dT%H%M%SZ"); iso = at.strftime("%Y-%m-%dT%H:%M:%SZ")
def w(name, data):
    open(os.path.join(d, name), "wb").write(data); return hashlib.sha256(data).hexdigest()
db = w("%s-db.sql.gz.age" % stamp, b"synthetic database archive")
fl = w("%s-uploads.tar.gz.age" % stamp, b"synthetic files archive")
open(os.path.join(d, "%s-manifest.txt" % stamp), "w").write("stamp:        %s\ndb_archive:   %s-db.sql.gz.age\ndb_sha256:    %s\nfiles_archive:%s-uploads.tar.gz.age\nfiles_sha256: %s\n" % (stamp, stamp, db, stamp, fl))
later = (at + timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
json.dump({"lastBackupAt": iso, "lastBackupStamp": stamp, "lastOffhostCopyAt": later, "lastOffhostStamp": stamp, "lastOffhostResult": "VERIFIED",
           "lastRestoreTestAt": later, "lastRestoreTestStamp": stamp, "lastRestoreTestResult": "PASSED"}, open(os.path.join(d, "status.json"), "w"))
print(stamp)
PY
}
edit() { python3 - "$1" "$2" <<'PY'   # edit <status.json> <python-statement on d>
import json, sys
p = sys.argv[1]; d = json.load(open(p)); exec(sys.argv[2]); json.dump(d, open(p, "w"))
PY
}
