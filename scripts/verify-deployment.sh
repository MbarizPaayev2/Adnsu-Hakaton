#!/usr/bin/env bash
#
# Read-only verification of a finished deployment, run on the host in the checkout:
#
#   EXPECT_SHA=<40-char release sha> \
#   EXPECT_IMAGES="api=sha256:<64 hex>,web=sha256:<64 hex>,matching-service=sha256:<64 hex>" \
#   scripts/verify-deployment.sh
#
# PASS/FAIL per check. Exit 0 only when every check passed, 1 when any check FAILED, 2 when it was called wrongly
# (and then it checked nothing). Prints states and ids only: never tokens, keys, passwords or data.
#
# EXPECT_IMAGES is REQUIRED: a comma-separated list of service=image-id (the full sha256:<64 hex> id, as printed by
# `docker image inspect --format '{{.Id}}'`). It must name every service in REQUIRED_IMAGE_SERVICES (default
# "api web matching-service"); an absent, malformed, duplicated or incomplete list is refused instead of skipped,
# because "the images that should be running" is the one thing this script exists to prove.
#
# Covers: the exact release and image ids that are RUNNING, database/API readiness, all migrations finished and
# matching the repository, the scorer's authenticated contract (rejects no token and a wrong token, accepts its own
# token and returns a 0-1 score), the scorer self-test, payments and live external auto-apply off, admin MFA key
# usable, public and local HTTP, and the last importer run. Pair with scripts/check-host-security.sh and
# scripts/check-health.sh.
#
# Fail-closed: a check that cannot run (container missing, docker exec failing, empty output) is a FAIL, never a
# pass. No check relies on a pipeline's last command or on an empty value meaning "off".
#
set -uo pipefail
cd "${DEPLOY_DIR:-$(dirname "$0")/..}" || { echo "cannot enter the deployment directory" >&2; exit 2; }

usage() { printf 'verify-deployment: %s\n' "$*" >&2; exit 2; }
EXPECT_SHA="${EXPECT_SHA:-}"
[[ "$EXPECT_SHA" =~ ^[0-9a-f]{40}$ ]] || usage "set EXPECT_SHA to the full 40-character release sha"
[ -n "${EXPECT_IMAGES:-}" ] || usage "set EXPECT_IMAGES (service=sha256:<64 hex>,...): the running image ids must be checked, not skipped"
REQUIRED_IMAGE_SERVICES="${REQUIRED_IMAGE_SERVICES:-api web matching-service}"
PUBLIC_URL="${PUBLIC_URL:-https://aisehr.com/}"

# ---- EXPECT_IMAGES: comma-separated, validated before anything runs ----
declare -a IMG_SVC=() IMG_ID=()
IFS=',' read -r -a _pairs <<< "$EXPECT_IMAGES"
for raw in "${_pairs[@]}"; do
  pair="${raw//[[:space:]]/}"
  [ -n "$pair" ] || usage "EXPECT_IMAGES has an empty entry (stray comma?)"
  [[ "$pair" =~ ^([a-z][a-z0-9-]*)=(sha256:[0-9a-f]{64})$ ]] || usage "EXPECT_IMAGES entry '${pair:0:40}' is not service=sha256:<64 hex>"
  for seen in "${IMG_SVC[@]:-}"; do [ "$seen" = "${BASH_REMATCH[1]}" ] && usage "EXPECT_IMAGES names ${BASH_REMATCH[1]} twice"; done
  IMG_SVC+=("${BASH_REMATCH[1]}"); IMG_ID+=("${BASH_REMATCH[2]}")
done
for need in $REQUIRED_IMAGE_SERVICES; do
  found=0; for s in "${IMG_SVC[@]}"; do [ "$s" = "$need" ] && found=1; done
  [ "$found" -eq 1 ] || usage "EXPECT_IMAGES must include $need (required: $REQUIRED_IMAGE_SERVICES)"
done

FAILS=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS+1)); }
# A bound on anything that talks to a container, where `timeout` exists (the Linux host has it).
bounded() { local s="$1"; shift; if command -v timeout >/dev/null 2>&1; then timeout "$s" "$@"; else "$@"; fi; }
# Runs a command, keeps its stdout+stderr in $OUT and its exit code in $RC. Never aborts the script.
run() { OUT="$("$@" 2>&1)"; RC=$?; }

# ---------------------------------------------------------------- release ----
head_sha="$(git rev-parse HEAD 2>/dev/null || true)"
[ "$head_sha" = "$EXPECT_SHA" ] && pass "checkout is exactly $EXPECT_SHA" || fail "checkout is ${head_sha:-unknown}, expected $EXPECT_SHA"

ready="$(curl -fsS --max-time 10 http://127.0.0.1:4000/health/ready 2>/dev/null || true)"
if [[ "$ready" == *'"database":"ok"'* && "$ready" == *'"redis":"ok"'* ]]; then pass "API ready: database and redis ok"; else fail "API not ready (${ready:0:120})"; fi
if [[ "$ready" == *"\"release\":\"${EXPECT_SHA:0:12}\""* ]]; then pass "API reports release ${EXPECT_SHA:0:12}"; else fail "API reports a different release"; fi
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/ 2>/dev/null)" = "200" ] && pass "web answers 200 locally" || fail "web does not answer 200 locally"
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PUBLIC_URL" 2>/dev/null)" = "200" ] && pass "$PUBLIC_URL answers 200" || fail "public site $PUBLIC_URL does not answer 200"

# ----------------------------------------------------------------- images ----
# The container must be RUNNING and created from exactly the expected image id.
for i in "${!IMG_SVC[@]}"; do
  svc="${IMG_SVC[$i]}"; want="${IMG_ID[$i]}"; cname="aise-$svc"
  run docker inspect "$cname" --format '{{.State.Running}} {{.Image}}'
  if [ "$RC" -ne 0 ]; then fail "$cname: cannot inspect the container (${OUT:0:80})"; continue; fi
  running="${OUT%% *}"; have="${OUT#* }"
  if [ "$running" != "true" ]; then fail "$cname is not running"
  elif [ "$have" = "$want" ]; then pass "$cname runs image ${want:0:19}…"
  else fail "$cname runs ${have:0:19}…, expected ${want:0:19}…"; fi
done

# ------------------------------------------------------------- migrations ----
# All finished, none failed or rolled back, and the newest equals the repository's newest.
newest_repo="$(ls apps/api/prisma/migrations 2>/dev/null | grep -E '^[0-9]' | sort | tail -n 1)"
repo_count="$(ls apps/api/prisma/migrations 2>/dev/null | grep -cE '^[0-9]')"
run docker exec aise-postgres psql -U postgres -d aise -At -F' ' -c "select count(*) filter (where finished_at is not null), max(migration_name), count(*) filter (where finished_at is null or rolled_back_at is not null) from _prisma_migrations"
if [ "$RC" -ne 0 ]; then
  fail "migrations: the database could not be queried (${OUT:0:80})"
else
  read -r finished newest_db unfinished <<< "$OUT"
  if [[ "${finished:-}" =~ ^[0-9]+$ && "${unfinished:-}" =~ ^[0-9]+$ && "$repo_count" -gt 0 && "$unfinished" = "0" && "$finished" = "$repo_count" ]]; then
    pass "all $finished migrations finished, none rolled back"
  else
    fail "migrations: finished=${finished:-?} repo=$repo_count unfinished=${unfinished:-?}"
  fi
  [ -n "${newest_db:-}" ] && [ "$newest_db" = "$newest_repo" ] && pass "newest migration in the database is $newest_repo" || fail "newest migration is ${newest_db:-?}, repository has ${newest_repo:-?}"
fi

# ----------------------------------------------------------------- scorer ----
# From inside its own container, so its token never leaves it. `-i` attaches stdin: without it the heredoc below
# would not reach python and the assertions would never run.
run bounded 180 docker exec -i aise-matching-service python - <<'PY'
import json, os, sys, urllib.error, urllib.request
url = os.environ.get("SCORER_URL", "http://127.0.0.1:8000/score")
job = {"title": "Mühasib", "slug": "verify", "location": "Bakı", "company": {"slug": "v", "name": "V"},
       "detail": {"title": "Mühasib", "company_name": "V", "location": "Bakı", "description_text": "Mühasibat uçotu, vergi hesabatları, 1C proqramı.", "requirements_text": "1C, Excel, mühasibat uçotu.", "category": "Maliyyə", "sidebar": {}}}
persona = {"candidate_id": "v", "languages": [{"code": "az"}], "years_of_experience": 3, "summary": "Mühasib", "target_titles": ["Mühasib"], "hard_skills": ["1C", "Excel", "Vergi uçotu"],
           "soft_skills": [], "experience_history": [], "education": {"rank": 4}, "salary_expectation": {"monthly_min": None, "monthly_max": None, "currency": "AZN"}, "preferred_cities": ["Bakı"], "work_arrangements": [], "certifications": []}
body = json.dumps({"job": job, "profiles": [{"profileId": "v", "persona": persona}]}).encode()

def call(token):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers), timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""

def bad(reason):
    print("BAD", reason)
    sys.exit(1)

real = os.environ.get("MATCHING_SERVICE_TOKEN", "")
if not real:
    bad("the scorer container has no MATCHING_SERVICE_TOKEN")
try:
    no_token, _ = call(None)
    wrong, _ = call("not-the-token")
    status, payload = call(real)
except Exception as e:
    bad("scorer unreachable: " + type(e).__name__)
if no_token != 401:
    bad("no token answered %s, expected 401" % no_token)
if wrong != 401:
    bad("wrong token answered %s, expected 401" % wrong)
if status != 200:
    bad("own token answered %s, expected 200" % status)
try:
    score = json.loads(payload)["results"][0]["score"]
except Exception:
    bad("own token returned an unreadable result")
if not isinstance(score, (int, float)) or isinstance(score, bool) or not 0 <= score <= 1:
    bad("score is outside 0..1")
print("OK", no_token, wrong, round(score, 3))
PY
last="$(printf '%s\n' "$OUT" | tail -n 1)"
if [ "$RC" -eq 0 ] && [[ "$last" =~ ^OK\ 401\ 401\ ([0-9.]+)$ ]]; then
  pass "scorer contract: no token 401, wrong token 401, own token returns a 0-1 score (${BASH_REMATCH[1]})"
else
  fail "scorer contract not proven (exit $RC): ${last:0:120}"
fi

run bounded 600 docker exec aise-matching-service python selftest.py
last="$(printf '%s\n' "$OUT" | tail -n 1)"
if [ "$RC" -eq 0 ] && [ "$last" = "ALL SELFTESTS PASSED" ]; then pass "scorer self-test passes inside the running container"; else fail "scorer self-test did not pass (exit $RC): ${last:0:80}"; fi

# ------------------------------------------------------- payments and flags ----
billing="$(curl -fsS --max-time 10 http://127.0.0.1:4000/billing/status 2>/dev/null || true)"
# EXPECT_PAYMENTS / EXPECT_DOCUMENTS state the intended launch state (default false = off); the check is exact either way.
EXPECT_PAYMENTS="${EXPECT_PAYMENTS:-false}"; EXPECT_DOCUMENTS="${EXPECT_DOCUMENTS:-false}"
if [[ "$billing" == *"\"paymentsEnabled\":$EXPECT_PAYMENTS"* ]]; then pass "payments are reported $EXPECT_PAYMENTS as intended (/billing/status)"; else fail "payments are not reported $EXPECT_PAYMENTS (${billing:0:80})"; fi

# The value is printed behind a marker so "the command failed" (no marker) can never read as "unset".
run docker exec aise-api sh -c 'printf "LIVE=%s\n" "${EXTERNAL_APPLY_LIVE_ENABLED:-}"'
live_line="$(printf '%s\n' "$OUT" | grep -E '^LIVE=' | tail -n 1)"
if [ "$RC" -ne 0 ] || [ -z "$live_line" ]; then
  fail "live external auto-apply: the container could not be read (exit $RC)"
elif [ "$live_line" = "LIVE=" ] || [ "$live_line" = "LIVE=false" ]; then
  pass "live external auto-apply is not enabled"
else
  fail "live external auto-apply is set to '${live_line#LIVE=}' (expected unset or false)"
fi

# Document generation is exactly "false" (default) or exactly "true" (when the launch step enables it); unset would mean ON and never passes.
run docker exec aise-api sh -c 'printf "DOCGEN=%s\n" "${DOCUMENT_GENERATION_ENABLED:-}"'
docgen_line="$(printf '%s\n' "$OUT" | grep -E '^DOCGEN=' | tail -n 1)"
if [ "$RC" -ne 0 ] || [ -z "$docgen_line" ]; then
  fail "document generation switch: the container could not be read (exit $RC)"
elif [ "$docgen_line" = "DOCGEN=$EXPECT_DOCUMENTS" ]; then
  pass "document generation switch is as intended (DOCUMENT_GENERATION_ENABLED=$EXPECT_DOCUMENTS)"
else
  fail "document generation switch is not as intended (DOCUMENT_GENERATION_ENABLED='${docgen_line#DOCGEN=}', expected $EXPECT_DOCUMENTS)"
fi

# Browser agent: assisted mode only as intended; autonomous mode must never be on (no portal is verified for it).
EXPECT_AGENT="${EXPECT_AGENT:-false}"
run docker exec aise-api sh -c 'printf "AGENT=%s\nAUTO=%s\n" "${BROWSER_AGENT_ENABLED:-false}" "${BROWSER_AGENT_AUTONOMOUS_ENABLED:-false}"'
agent_line="$(printf '%s\n' "$OUT" | grep -E '^AGENT=' | tail -n 1)"; auto_line="$(printf '%s\n' "$OUT" | grep -E '^AUTO=' | tail -n 1)"
if [ "$RC" -ne 0 ] || [ -z "$agent_line" ]; then fail "browser agent switch: the container could not be read (exit $RC)"
elif [ "$agent_line" = "AGENT=$EXPECT_AGENT" ]; then pass "browser agent switch is as intended (BROWSER_AGENT_ENABLED=$EXPECT_AGENT)"
else fail "browser agent switch is not as intended (${agent_line#AGENT=}, expected $EXPECT_AGENT)"; fi
if [ "$auto_line" = "AUTO=false" ]; then pass "browser agent autonomous mode is off"; else fail "browser agent autonomous mode is not off (${auto_line#AUTO=})"; fi

# Employer plans / employer billing: exactly the stated intent (default off; unset is off). A paid employer offer must never be live by accident.
EXPECT_EMPLOYER_PLANS="${EXPECT_EMPLOYER_PLANS:-false}"; EXPECT_EMPLOYER_BILLING="${EXPECT_EMPLOYER_BILLING:-false}"
run docker exec aise-api sh -c 'printf "EPLANS=%s\nEBILL=%s\n" "${EMPLOYER_PLANS_ENABLED:-false}" "${EMPLOYER_BILLING_ENABLED:-false}"'
eplans_line="$(printf '%s\n' "$OUT" | grep -E '^EPLANS=' | tail -n 1)"; ebill_line="$(printf '%s\n' "$OUT" | grep -E '^EBILL=' | tail -n 1)"
if [ "$RC" -ne 0 ] || [ -z "$eplans_line" ]; then fail "employer plans switches: the container could not be read (exit $RC)"
else
  [ "$eplans_line" = "EPLANS=$EXPECT_EMPLOYER_PLANS" ] && pass "employer plans switch is as intended (EMPLOYER_PLANS_ENABLED=$EXPECT_EMPLOYER_PLANS)" || fail "employer plans switch is not as intended (${eplans_line#EPLANS=}, expected $EXPECT_EMPLOYER_PLANS)"
  [ "$ebill_line" = "EBILL=$EXPECT_EMPLOYER_BILLING" ] && pass "employer billing switch is as intended (EMPLOYER_BILLING_ENABLED=$EXPECT_EMPLOYER_BILLING)" || fail "employer billing switch is not as intended (${ebill_line#EBILL=}, expected $EXPECT_EMPLOYER_BILLING)"
fi

# Only that the key decodes to 32 bytes is checked; the value is never printed.
run docker exec aise-api node -e 'const k=Buffer.from(process.env.ADMIN_MFA_ENCRYPTION_KEY||"","base64");process.exit(k.length===32?0:1)'
[ "$RC" -eq 0 ] && pass "admin MFA is available (a 32-byte key is configured)" || fail "admin MFA key is missing or not 32 bytes (exit $RC)"

# --------------------------------------------------------------- importer ----
run docker exec aise-postgres psql -U postgres -d aise -At -F' ' -c "select status, to_char(\"startedAt\",'MM-DD HH24:MI') from \"JobImportRun\" order by \"startedAt\" desc limit 1"
if [ "$RC" -eq 0 ] && [ -n "$OUT" ]; then pass "last importer run: $OUT (the hourly importer was not changed)"; else fail "no importer run could be read (exit $RC)"; fi

echo; if [ "$FAILS" -eq 0 ]; then echo "deployment verification: all checks passed"; else echo "deployment verification: $FAILS check(s) FAILED"; fi
[ "$FAILS" -eq 0 ]
