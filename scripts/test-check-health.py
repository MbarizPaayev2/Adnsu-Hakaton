#!/usr/bin/env python3
"""Tests scripts/check-health.sh end to end against a fake API, fake Uptime Kuma and fake Resend, in one process.
Checks: healthy -> exit 0 and Kuma 'up'; each problem -> exit 1, Kuma 'down', one email; the same problem is not
re-emailed inside the window, a different one is, recovery is emailed once; the API key reaches the mail service
but never the script's output; durable-destination alert; stale/failed/future evidence alerts.
Run: python3 scripts/test-check-health.py  (needs GNU `date -d` semantics: run on Linux, or a `date` shim on macOS)
"""
import datetime, http.server, json, os, shutil, subprocess, sys, tempfile, threading

HERE = os.path.dirname(os.path.abspath(__file__))
work = tempfile.mkdtemp(); fails = 0
def ok(msg): print("PASS ", msg)
def bad(msg):
    global fails; fails += 1; print("FAIL ", msg)

# macOS has no `date -d`; a tiny shim gives the script the GNU behaviour it needs.
shim = os.path.join(work, "bin"); os.makedirs(shim)
open(os.path.join(shim, "date"), "w").write('''#!/usr/bin/env bash
if [ "$1" = "-u" ] && [ "$2" = "-d" ]; then python3 -c "import sys,datetime;print(int(datetime.datetime.strptime(sys.argv[1],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()))" "$3"; else exec /bin/date "$@"; fi
''')
os.chmod(os.path.join(shim, "date"), 0o755)

SECRET = "re_test_secret_value_123"
mails, kuma = [], []
class Api(http.server.BaseHTTPRequestHandler):
    healthy = True
    def do_GET(self):
        if self.path.startswith("/api/push/"): kuma.append(self.path); self.send_response(200); self.end_headers(); self.wfile.write(b"{}"); return
        self.send_response(200 if Api.healthy else 503); self.end_headers(); self.wfile.write(b'{"status":"ok","release":"t"}')
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        mails.append({"auth": self.headers.get("authorization"), "body": json.loads(body)})
        self.send_response(200); self.end_headers(); self.wfile.write(b"{}")
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Api); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % srv.server_address[1]

env_file = os.path.join(work, "api.env"); open(env_file, "w").write("OTHER=1\nRESEND_API_KEY=%s\n" % SECRET)
status = os.path.join(work, "status.json")
def write_status(**over):
    now = datetime.datetime.now(datetime.timezone.utc)
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
    st = {"lastBackupAt": iso(now), "lastBackupStamp": now.strftime("%Y%m%dT%H%M%SZ"), "lastOffhostCopyAt": iso(now), "lastOffhostResult": "VERIFIED",
          "lastOffhostDestination": "bucket", "lastRestoreTestAt": iso(now), "lastRestoreTestResult": "PASSED"}
    st.update(over)
    for k in [k for k, v in st.items() if v is None]: del st[k]
    json.dump(st, open(status, "w"))
def run(**extra):
    env = dict(os.environ, PATH=shim + ":" + os.environ["PATH"], API_URL=base, STATUS_FILE=status, MIN_FREE_DISK_PCT="1",
               UPTIME_KUMA_PUSH_URL=base + "/api/push/T", ALERT_EMAIL_TO="founder@example.invalid", RESEND_ENV_FILE=env_file,
               RESEND_API_URL=base + "/emails", ALERT_STATE_FILE=os.path.join(work, "alert-state"), DOCKER="/nonexistent-docker")
    env.update(extra)
    return subprocess.run([os.path.join(HERE, "check-health.sh")], env=env, capture_output=True, text=True)

fake = os.path.join(work, "fakedocker"); open(fake, "w").write("#!/usr/bin/env bash\n[ \"$1\" = inspect ] && exit 0\n[ \"$1\" = exec ] && { printf '%s' \"$FAKE_DOCKER_SQL\"; exit 0; }\nprintf '%s' \"$FAKE_DOCKER_LOGS\"\n"); os.chmod(fake, 0o755)
write_status(); mails.clear(); kuma.clear()
r = run(DOCKER=fake, FAKE_DOCKER_LOGS="LOG fine\n[EMAIL ERROR] Failed to send email to ***@x after 3 attempt(s) (validation_error)\n"); (ok if r.returncode == 1 and "outbound e-mail failing: 1 send failure" in r.stdout and len(mails) == 1 else bad)("e-mail send failures in the API log alert and are mailed once")
r = run(DOCKER=fake, FAKE_DOCKER_LOGS="LOG fine\n"); (ok if "no outbound e-mail failures" in r.stdout else bad)("a quiet API log reports no e-mail failures")
write_status(); mails.clear(); kuma.clear()
r = run(DOCKER=fake, FAKE_DOCKER_SQL="stale|glorri|10-07 03:00 (allowed 180 min)\ncooldown|work|HTTP 429 block\nunexpected|hellojob|\n"); (ok if r.returncode == 1 and "source 'glorri' has had no finished run within its schedule (last: 10-07 03:00 (allowed 180 min))" in r.stdout and "source 'work' is in cooldown" in r.stdout and "source 'hellojob' is scheduled but is not on the production allowlist" in r.stdout and len(mails) == 1 and "glorri" in mails[-1]["body"]["text"] else bad)("a stale, a cooling-down and a non-allowlisted source alert and are mailed once")
write_status(); mails.clear(); kuma.clear(); state_file = os.path.join(work, "alert-state"); os.path.exists(state_file) and os.remove(state_file)
r = run(DOCKER=fake, FAKE_DOCKER_SQL=""); (ok if r.returncode == 0 and "vacancy sources: scheduled sources fresh" in r.stdout and not mails else bad)("healthy sources: no alert, no mail")
write_status(); mails.clear(); kuma.clear(); os.path.exists(state_file) and os.remove(state_file)
r = run(); (ok if r.returncode == 0 and kuma[-1].startswith("/api/push/T?status=up") and not mails else bad)("healthy: exit 0, Kuma up, no email")

write_status(lastOffhostDestination="founder-mac-pull")
r = run(); (ok if r.returncode == 1 and "not the durable bucket" in r.stdout and kuma[-1].find("status=down") > 0 else bad)("a non-durable off-host destination alerts")
(ok if len(mails) == 1 else bad)("...and one email is sent")
r = run(); (ok if len(mails) == 1 else bad)("the same problem is not emailed again inside the window")
write_status(lastOffhostDestination="bucket", lastRestoreTestResult="FAILED")
r = run(); (ok if r.returncode == 1 and len(mails) == 2 and "restore test" in mails[-1]["body"]["text"] else bad)("a different problem is emailed")
(ok if mails[-1]["auth"] == "Bearer " + SECRET else bad)("the mail service received the key")
(ok if SECRET not in r.stdout + r.stderr and not any(SECRET in json.dumps(m["body"]) for m in mails) else bad)("the key never appears in script output or in the message body")
write_status()
r = run(); (ok if r.returncode == 0 and len(mails) == 3 and "recovered" in mails[-1]["body"]["subject"] else bad)("recovery is emailed once")
r = run(); (ok if len(mails) == 3 else bad)("...and only once")
old = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=60)).strftime("%Y-%m-%dT%H:%M:%SZ")
write_status(lastBackupAt=old, lastOffhostCopyAt=old)
r = run(); (ok if r.returncode == 1 and "old" in r.stdout else bad)("a stale backup alerts")
write_status(lastBackupFailureAt="2026-10-01T03:10:00Z", lastBackupError="off-host copy failed")
r = run(); (ok if r.returncode == 1 and "backup job failed" in r.stdout else bad)("a recorded failure alerts")
Api.healthy = False; write_status()
r = run(); (ok if r.returncode == 1 and "API not ready" in r.stdout else bad)("an unhealthy API alerts")
Api.healthy = True
mails.clear(); write_status(lastOffhostDestination="founder-mac-pull"); os.remove(os.path.join(work, "alert-state")) if os.path.exists(os.path.join(work, "alert-state")) else None
r = run(ALERT_EMAIL_TO=""); (ok if r.returncode == 1 and not mails else bad)("no recipient configured: alerts still exit 1, no email attempted")
shutil.rmtree(work)
print(); print("HEALTH MONITOR TESTS PASSED" if not fails else "HEALTH MONITOR TESTS: %d FAILED" % fails)
sys.exit(1 if fails else 0)
