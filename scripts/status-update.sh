#!/usr/bin/env bash
#
# Atomically merges key=value pairs into the backup status JSON that the admin
# panel (/admin/system) and scripts/check-health.sh read.
#
#   scripts/status-update.sh [--file PATH] key=value [key=value ...]
#
# Existing keys are kept. Values are written as JSON strings; an empty value
# removes the key. Never put secrets, file contents or stack traces in a value.
#
set -euo pipefail
FILE="${STATUS_FILE:-/var/backups/aise/status/status.json}"
if [ "${1:-}" = "--file" ]; then FILE="$2"; shift 2; fi
[ "$#" -gt 0 ] || { echo "usage: status-update.sh [--file PATH] key=value ..." >&2; exit 2; }
mkdir -p "$(dirname "$FILE")"
python3 - "$FILE" "$@" <<'PY'
import json, os, sys, tempfile
path, pairs = sys.argv[1], sys.argv[2:]
try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        data = {}
except (FileNotFoundError, ValueError):
    data = {}
for pair in pairs:
    key, sep, value = pair.partition("=")
    if not sep or not key.replace("_", "").isalnum():
        sys.exit("bad pair: %r" % pair)
    if value == "":
        data.pop(key, None)
    else:
        data[key] = value[:300]
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", prefix=".status-")
with os.fdopen(fd, "w", encoding="utf-8") as fh:
    json.dump(data, fh, sort_keys=True)
    fh.write("\n")
os.chmod(tmp, 0o644)  # read by the API container (runs as a different user); no secrets inside
os.replace(tmp, path)
PY
