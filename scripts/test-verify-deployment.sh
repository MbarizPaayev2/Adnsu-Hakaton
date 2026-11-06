#!/usr/bin/env bash
#
# Tests scripts/verify-deployment.sh end to end, with no Docker, network or production access:
#
#   scripts/test-verify-deployment.sh
#
# The verifier runs for real against stand-ins placed first on PATH:
#   - `docker`: inspect/exec, emulating the one behaviour that mattered — `docker exec` hands its stdin to the
#     command ONLY with -i (without it, `python -` reads an empty program, runs nothing and exits 0);
#   - `curl`: the local API/web/public/billing endpoints;
#   - a real fake scorer HTTP server, so the verifier's Python assertions genuinely execute.
# Proves: the happy path passes; an absent/malformed/duplicated/incomplete EXPECT_IMAGES is refused (exit 2,
# nothing checked) and a comma-separated list is parsed; every single failure flips the exit code to 1 with its
# own FAIL line (wrong or stopped container, wrong checkout/release, readiness, migrations, each scorer contract
# violation, self-test exit/message, payments on, live auto-apply on/odd value/unreadable container, MFA key
# missing/short, importer unreadable); and — mutation tests — removing `-i` or the fail-closed live-flag read makes
# the suite fail, so these tests would have caught the defects they guard.
#
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"; chmod 700 "$WORK"
FAILS=0
ok()  { printf 'PASS  %s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS+1)); }
SCORER_PID=""
cleanup() { [ -n "$SCORER_PID" ] && kill "$SCORER_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

export SHIM_STATE="$WORK/state"; mkdir -p "$SHIM_STATE" "$WORK/bin" "$WORK/deploy"
export PATH="$WORK/bin:$PATH"

# ---- a deployment directory: a git checkout with two migrations ----
(cd "$WORK/deploy" && git init -q . && mkdir -p apps/api/prisma/migrations/20260101000000_first apps/api/prisma/migrations/20260102000000_second \
  && touch apps/api/prisma/migrations/20260101000000_first/migration.sql apps/api/prisma/migrations/20260102000000_second/migration.sql \
  && git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -q -m t)
SHA="$(git -C "$WORK/deploy" rev-parse HEAD)"
H() { printf 'sha256:%064d' "$1" | tr ' ' '0'; }
IMG_API="$(H 1)"; IMG_WEB="$(H 2)"; IMG_MATCH="$(H 3)"

# ---- fake scorer (a real HTTP server; mode is read from a file on every request) ----
cat > "$WORK/scorer.py" <<'PY'
import http.server, json, sys, os
state = sys.argv[1]
def mode(): return open(os.path.join(state, "scorer.mode")).read().strip() if os.path.exists(os.path.join(state, "scorer.mode")) else "good"
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length", 0)))
        token = (self.headers.get("authorization") or "")[7:]
        m = mode()
        authed = token == "tok" or (m == "open" and token == "") or (m == "wrong200" and token == "not-the-token")
        if not authed: self.send_response(401); self.end_headers(); self.wfile.write(b"{}"); return
        if m == "err500": self.send_response(500); self.end_headers(); return
        if m == "noresult": body = {"results": []}
        elif m == "badscore": body = {"results": [{"score": 1.7}]}
        else: body = {"results": [{"score": 0.62}]}
        self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(body).encode())
    def log_message(self, *a): pass
srv = http.server.HTTPServer(("127.0.0.1", 0), H)
open(os.path.join(state, "scorer.port"), "w").write(str(srv.server_address[1]))
srv.serve_forever()
PY
python3 "$WORK/scorer.py" "$SHIM_STATE" & SCORER_PID=$!
for _ in $(seq 1 50); do [ -s "$SHIM_STATE/scorer.port" ] && break; sleep 0.1; done

# ---- fake docker ----
cat > "$WORK/bin/docker" <<'SH'
#!/usr/bin/env bash
S="$SHIM_STATE"
val() { [ -f "$S/$1" ] && cat "$S/$1" || printf '%s' "$2"; }
sub="$1"; shift
case "$sub" in
  inspect)
    name="$1"
    if [ -f "$S/missing.$name" ]; then echo "Error: No such object: $name" >&2; exit 1; fi
    svc="${name#aise-}"
    echo "$(val "running.$name" true) $(val "image.$name" "$(cat "$S/image.$svc")")"; exit 0 ;;
  exec)
    stdin_attached=0; [ "$1" = "-i" ] && { stdin_attached=1; shift; }
    c="$1"; shift
    if [ -f "$S/execfail.$c" ]; then echo "Error response from daemon: container is not running" >&2; exit 1; fi
    case "$c:$*" in
      aise-postgres:*_prisma_migrations*) val mig.out "2 20260102000000_second 0"; echo; exit "$(val mig.rc 0)" ;;
      aise-postgres:*JobImportRun*)       val importer.out "SUCCEEDED 10-01 12:00"; echo; exit "$(val importer.rc 0)" ;;
      aise-matching-service:python\ -)
        export SCORER_URL="http://127.0.0.1:$(cat "$S/scorer.port")/score" MATCHING_SERVICE_TOKEN=tok
        if [ "$stdin_attached" -eq 1 ]; then exec python3 -; else exec python3 - </dev/null; fi ;;
      aise-matching-service:python\ selftest.py) val selftest.out "ok ok
ALL SELFTESTS PASSED"; echo; exit "$(val selftest.rc 0)" ;;
      aise-api:sh\ -c*)
        if [ -f "$S/live.value" ]; then export EXTERNAL_APPLY_LIVE_ENABLED="$(cat "$S/live.value")"; else unset EXTERNAL_APPLY_LIVE_ENABLED; fi
        if [ -f "$S/docgen.value" ]; then export DOCUMENT_GENERATION_ENABLED="$(cat "$S/docgen.value")"; else export DOCUMENT_GENERATION_ENABLED=false; fi
        if [ "$(cat "$S/docgen.value" 2>/dev/null)" = "UNSET" ]; then unset DOCUMENT_GENERATION_ENABLED; fi
        exec sh -c "$3" ;;
      aise-api:node\ -e*)
        if [ -f "$S/mfa.value" ]; then export ADMIN_MFA_ENCRYPTION_KEY="$(cat "$S/mfa.value")"; else unset ADMIN_MFA_ENCRYPTION_KEY; fi
        exec node -e "$3" ;;
    esac
    echo "fake docker: unexpected exec $c $*" >&2; exit 125 ;;
esac
echo "fake docker: unexpected $sub" >&2; exit 125
SH
# ---- fake curl ----
cat > "$WORK/bin/curl" <<'SH'
#!/usr/bin/env bash
S="$SHIM_STATE"
val() { [ -f "$S/$1" ] && cat "$S/$1" || printf '%s' "$2"; }
url=""; wfmt=""; out=""; fflag=0
while [ $# -gt 0 ]; do case "$1" in -w) wfmt="$2"; shift ;; -o) out="$2"; shift ;; --max-time) shift ;; -*f*) case "$1" in -*[fsS]*) [[ "$1" == *f* ]] && fflag=1 ;; esac ;; http*) url="$1" ;; esac; shift; done
case "$url" in
  *:4000/health/ready) code="$(val ready.code 200)"; body="$(val ready.json "{\"status\":\"ok\",\"checks\":{\"database\":\"ok\",\"redis\":\"ok\"},\"release\":\"$(git rev-parse HEAD | cut -c1-12)\"}")" ;;
  *:3000/)             code="$(val web.code 200)"; body="<html>" ;;
  *:4000/billing/status) code="$(val billing.code 200)"; body="$(val billing.json '{"paymentsEnabled":false,"mode":"live"}')" ;;
  https://*)           code="$(val public.code 200)"; body="<html>" ;;
  *) echo "fake curl: unexpected $url" >&2; exit 6 ;;
esac
[ "$code" = "000" ] && exit 7
if [ "$fflag" = 1 ] && [ "${code:0:1}" -ge 4 ]; then exit 22; fi
[ -n "$wfmt" ] && { [ "$out" = "/dev/null" ] || printf '%s' "$body"; printf '%s' "${wfmt//%\{http_code\}/$code}"; exit 0; }
printf '%s' "$body"
SH
chmod +x "$WORK/bin/docker" "$WORK/bin/curl"

reset() {
  find "$SHIM_STATE" -type f ! -name scorer.port -delete
  printf '%s' "$IMG_API" > "$SHIM_STATE/image.api"; printf '%s' "$IMG_WEB" > "$SHIM_STATE/image.web"; printf '%s' "$IMG_MATCH" > "$SHIM_STATE/image.matching-service"
  printf '%s' "$(printf 'k%.0s' {1..32} | base64)" > "$SHIM_STATE/mfa.value"
}
GOOD_IMAGES="api=$IMG_API,web=$IMG_WEB,matching-service=$IMG_MATCH"
VERIFIER="${VERIFIER_UNDER_TEST:-$HERE/verify-deployment.sh}"
verify() { # extra env assignments are passed through the caller's environment
  OUT="$(DEPLOY_DIR="$WORK/deploy" EXPECT_SHA="$SHA" EXPECT_IMAGES="${IMAGES-$GOOD_IMAGES}" "${V:-$VERIFIER}" 2>&1)"; RC=$?
}
expect() { # description, exit code, optional pattern that must be in the output
  local desc="$1" code="$2" pat="${3:-}"
  if [ "$RC" -ne "$code" ]; then bad "$desc (exit $RC, wanted $code)"; printf '%s\n' "$OUT" | sed 's/^/      /' | head -12; return; fi
  if [ -n "$pat" ] && ! grep -q -- "$pat" <<<"$OUT"; then bad "$desc (missing: $pat)"; printf '%s\n' "$OUT" | sed 's/^/      /' | head -12; return; fi
  ok "$desc"
}
fails_only() { # description, a pattern for the ONE FAIL line expected; every other check must still pass
  local desc="$1" pat="$2" n; n="$(grep -c '^FAIL' <<<"$OUT")"
  if [ "$RC" -eq 1 ] && [ "$n" -eq 1 ] && grep -q "^FAIL.*$pat" <<<"$OUT"; then ok "$desc"; else bad "$desc (exit $RC, $n FAIL lines)"; printf '%s\n' "$OUT" | grep -E '^(FAIL|verify)' | sed 's/^/      /'; fi
}

echo "== happy path and input handling"
reset; verify; expect "all checks pass and the exit code is 0" 0 "all checks passed"
[ "$(grep -c '^PASS' <<<"$OUT")" -ge 14 ] && ok "every check reported PASS ($(grep -c '^PASS' <<<"$OUT"))" || bad "fewer PASS lines than expected"
grep -q 'sha256:000000000000…' <<<"$OUT" && ok "images are shown as truncated ids" || bad "image ids not shown"
reset; IMAGES="api=$IMG_API, web=$IMG_WEB , matching-service=$IMG_MATCH,apply-worker=$(H 4)" verify; RC_AW=$RC
IMAGES="" verify; expect "an empty EXPECT_IMAGES is refused, nothing checked" 2 "must be checked, not skipped"
grep -q '^PASS\|^FAIL' <<<"$OUT" && bad "a refused call still ran checks" || ok "a refused call ran no checks"
OUT="$(DEPLOY_DIR="$WORK/deploy" EXPECT_SHA="$SHA" "$VERIFIER" 2>&1)"; RC=$?; expect "an ABSENT EXPECT_IMAGES is refused (it used to skip the image checks)" 2 "EXPECT_IMAGES"
IMAGES="api=$IMG_API,web=$IMG_WEB" verify; expect "an incomplete list (no matching-service) is refused" 2 "must include matching-service"
IMAGES="api=$IMG_API,web=$IMG_WEB,matching-service=${IMG_MATCH:0:20}" verify; expect "a short image id is refused" 2 "not service=sha256"
IMAGES="api=$IMG_API,web=$IMG_WEB,matching-service=$IMG_MATCH,web=$IMG_WEB" verify; expect "a service named twice is refused" 2 "twice"
IMAGES="api=$IMG_API,,web=$IMG_WEB,matching-service=$IMG_MATCH" verify; expect "a stray comma is refused" 2 "empty entry"
IMAGES="api=$IMG_API web=$IMG_WEB matching-service=$IMG_MATCH" verify; expect "space-separated entries are refused, not half-parsed" 2 "not service=sha256"
OUT="$(DEPLOY_DIR="$WORK/deploy" EXPECT_SHA="abc123" EXPECT_IMAGES="$GOOD_IMAGES" "$VERIFIER" 2>&1)"; RC=$?; expect "a short EXPECT_SHA is refused" 2 "40-character"
reset; IMAGES="$GOOD_IMAGES,apply-worker=$(H 4)" verify; expect "an extra, optional service is checked too (and its absence is a FAIL)" 1 "aise-apply-worker"
reset; printf '%s' "$(H 4)" > "$SHIM_STATE/image.apply-worker"; IMAGES="$GOOD_IMAGES,apply-worker=$(H 4)" verify; expect "...and passes when it matches" 0

echo "== release and images"
reset; echo "{\"status\":\"ok\",\"checks\":{\"database\":\"ok\",\"redis\":\"ok\"},\"release\":\"${SHA:0:12}\"}" > "$SHIM_STATE/ready.json"
git -C "$WORK/deploy" -c user.name=t -c user.email=t@t commit -q --allow-empty -m moved; verify; fails_only "a checkout that moved past EXPECT_SHA (the API still reports the right release)" "checkout is"
git -C "$WORK/deploy" reset -q --hard "$SHA"
reset; echo '{"status":"ok","checks":{"database":"ok","redis":"ok"},"release":"deadbeef0000"}' > "$SHIM_STATE/ready.json"; verify; fails_only "the API reporting a different release" "different release"
reset; echo '{"status":"unavailable","checks":{"database":"fail","redis":"ok"},"release":"'"${SHA:0:12}"'"}' > "$SHIM_STATE/ready.json"; echo 503 > "$SHIM_STATE/ready.code"; verify; expect "API not ready" 1 "API not ready"
reset; echo 502 > "$SHIM_STATE/web.code"; verify; fails_only "web not answering 200" "web does not answer"
reset; echo 000 > "$SHIM_STATE/public.code"; verify; fails_only "public site unreachable" "public site"
reset; printf '%s' "$(H 9)" > "$SHIM_STATE/image.web"; verify; fails_only "web running a different image" "aise-web runs"
reset; printf 'false %s' "$IMG_API" > "$SHIM_STATE/running.aise-api"; verify; fails_only "a stopped api container" "aise-api is not running"
reset; touch "$SHIM_STATE/missing.aise-matching-service"; verify; fails_only "a missing matching container" "cannot inspect"

echo "== migrations"
reset; echo "1 20260102000000_second 0" > "$SHIM_STATE/mig.out"; verify; expect "fewer finished migrations than the repository" 1 "migrations: finished=1"
reset; echo "2 20260102000000_second 1" > "$SHIM_STATE/mig.out"; verify; expect "an unfinished or rolled-back migration" 1 "unfinished=1"
reset; echo "2 20260101000000_first 0" > "$SHIM_STATE/mig.out"; verify; fails_only "the newest migration differing from the repository" "newest migration is"
reset; echo "" > "$SHIM_STATE/mig.out"; echo 1 > "$SHIM_STATE/mig.rc"; verify; expect "an unreachable database" 1 "could not be queried"
reset; echo "x y z" > "$SHIM_STATE/mig.out"; verify; expect "garbage instead of counts" 1 "migrations: finished="

echo "== scorer contract (the python assertions really run)"
for m in open wrong200 badscore err500 noresult; do
  reset; echo "$m" > "$SHIM_STATE/scorer.mode"; verify; fails_only "scorer mode '$m' is detected" "scorer contract not proven"
done
reset; touch "$SHIM_STATE/execfail.aise-matching-service"; verify; expect "an unreachable scorer container fails the contract and the self-test" 1 "scorer contract not proven"
grep -q "self-test did not pass" <<<"$OUT" && ok "...and the self-test" || bad "self-test not failed with the container"
reset; echo "ok" > "$SHIM_STATE/selftest.out"; verify; fails_only "a self-test that never prints the success line" "self-test did not pass"
reset; echo 1 > "$SHIM_STATE/selftest.rc"; verify; fails_only "a self-test that prints success but exits non-zero (pipefail case)" "self-test did not pass"

echo "== payments, live auto-apply, MFA, importer"
reset; echo '{"paymentsEnabled":true,"mode":"live"}' > "$SHIM_STATE/billing.json"; verify; fails_only "payments reported on" "payments are not reported off"
reset; echo 500 > "$SHIM_STATE/billing.code"; verify; fails_only "billing status unreachable" "payments are not reported off"
for v in true TRUE 1 yes; do reset; echo "$v" > "$SHIM_STATE/live.value"; verify; fails_only "live auto-apply set to '$v'" "live external auto-apply is set to"; done
reset; echo false > "$SHIM_STATE/live.value"; verify; expect "live auto-apply explicitly false passes" 0
reset; rm -f "$SHIM_STATE/live.value"; verify; expect "live auto-apply unset passes" 0
reset; echo true > "$SHIM_STATE/live.value"; touch "$SHIM_STATE/execfail.aise-api"; verify; expect "an unreadable api container is a FAIL for the flag, never 'off'" 1 "could not be read"
reset; touch "$SHIM_STATE/execfail.aise-api"; verify; grep -q "^PASS.*live external auto-apply" <<<"$OUT" && bad "an unreadable container passed the live-apply check" || ok "an unreadable container never passes the live-apply check"
reset; rm -f "$SHIM_STATE/mfa.value"; verify; fails_only "no MFA key" "MFA key is missing"
echo "== document generation switch"
reset; echo UNSET > "$SHIM_STATE/docgen.value"; verify; fails_only "document generation flag unset (would mean on)" "document generation is not switched off"
reset; echo true > "$SHIM_STATE/docgen.value"; verify; fails_only "document generation flag true" "document generation is not switched off"
reset; touch "$SHIM_STATE/execfail.aise-api"; verify; grep -q "FAIL.*document generation switch: the container could not be read" <<<"$OUT" && ok "an unreadable container fails the document generation check" || bad "an unreadable container did not fail the document generation check"
reset; printf 'short' | base64 > "$SHIM_STATE/mfa.value"; verify; fails_only "an MFA key that is not 32 bytes" "MFA key is missing or not 32 bytes"
grep -q "kkkkkkkk" <<<"$OUT" && bad "the MFA key value leaked into the output" || ok "the MFA key value is never printed"
reset; echo 1 > "$SHIM_STATE/importer.rc"; verify; fails_only "an unreadable importer table" "no importer run"
reset; echo "" > "$SHIM_STATE/importer.out"; verify; fails_only "no importer run recorded" "no importer run"

echo "== mutation tests: the suite must catch the original defects"
mut="$WORK/mut-no-i.sh"; sed 's/docker exec -i aise-matching-service/docker exec aise-matching-service/' "$VERIFIER" > "$mut"; chmod +x "$mut"
reset; V="$mut" verify; [ "$RC" -eq 1 ] && grep -q "scorer contract not proven" <<<"$OUT" && ok "without -i the heredoc never runs and the verifier FAILS (a no-op python is not a pass)" || bad "removing -i was not caught"
mut2="$WORK/mut-live.sh"; python3 - "$VERIFIER" "$mut2" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
# The historical fail-open read: an empty value (including "docker exec failed") counted as "not enabled".
a = s.index("run docker exec aise-api sh -c 'printf \"LIVE=")
b = s.index("# Only that the key decodes")
s = s[:a] + '[ "$(docker exec aise-api printenv EXTERNAL_APPLY_LIVE_ENABLED 2>/dev/null)" != "true" ] && pass "live external auto-apply is not enabled" || fail "live external auto-apply is enabled"\n\n' + s[b:]
open(sys.argv[2], "w").write(s)
PY
chmod +x "$mut2"; reset; touch "$SHIM_STATE/execfail.aise-api"; V="$mut2" verify
grep -q "^PASS.*live external auto-apply is not enabled" <<<"$OUT" && ok "(control) the historical fail-open read PASSES an unreadable container, so the fail-closed test above is meaningful" || bad "mutation control did not reproduce the historical defect"
unset V

echo
[ "$FAILS" -eq 0 ] && echo "verify-deployment tests: all passed" || echo "verify-deployment tests: $FAILS FAILED"
[ "$FAILS" -eq 0 ]
