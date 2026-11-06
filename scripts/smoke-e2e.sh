#!/usr/bin/env bash
# Runs the complete native AISE marketplace journey against a live stack.
#
# This deliberately uses direct database access only for test setup that a
# normal user cannot perform: reading verification tokens from the mail outbox
# equivalent, approving a synthetic company, and granting a synthetic paid
# entitlement so the account cannot exhaust its match quota on existing jobs.
# Every product action itself goes through the public HTTP API.
#
#   ALLOW_E2E_DATA=1 ./scripts/smoke-e2e.sh
#   API_URL=https://aisehr.com/backend ALLOW_E2E_DATA=1 ./scripts/smoke-e2e.sh
#
set -euo pipefail

[ "${ALLOW_E2E_DATA:-}" = "1" ] || {
  echo "Refusing to create synthetic records. Re-run with ALLOW_E2E_DATA=1." >&2
  exit 2
}

API_URL="${API_URL:-http://127.0.0.1:4000}"
DB_CONTAINER="${DB_CONTAINER:-aise-postgres}"
API_CONTAINER="${API_CONTAINER:-aise-api}"
KEEP_FIXTURES="${KEEP_FIXTURES:-0}"
STAMP="$(date -u +%Y%m%d%H%M%S)-$$"
CANDIDATE_EMAIL="aise-e2e-candidate-${STAMP}@example.invalid"
BUSINESS_EMAIL="aise-e2e-business-${STAMP}@example.invalid"
PASSWORD="Aise-E2E-${STAMP}!"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aise-e2e.XXXXXX")"
CV_PATH="$WORK_DIR/aise-e2e-cv.docx"
AUTH_HEADER=()
BUSINESS_AUTH_HEADER=()

for command in curl jq docker python3; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 2; }
done
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || { echo "$DB_CONTAINER is not running" >&2; exit 2; }

log() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nE2E FAILED: %s\n' "$*" >&2; exit 1; }

sql() {
  docker exec "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d aise -At -c "$1"
}

post_json() {
  local path="$1" body="$2"
  shift 2
  curl --fail-with-body -sS -X POST "${API_URL}${path}" \
    -H 'Content-Type: application/json' "$@" --data "$body"
}

patch_json() {
  local path="$1" body="$2"
  shift 2
  curl --fail-with-body -sS -X PATCH "${API_URL}${path}" \
    -H 'Content-Type: application/json' "$@" --data "$body"
}

get_json() {
  local path="$1"
  shift
  curl --fail-with-body -sS "${API_URL}${path}" "$@"
}

cleanup() {
  local exit_code=$?
  if [ "$KEEP_FIXTURES" = "1" ]; then
    echo "Keeping fixtures: $CANDIDATE_EMAIL and $BUSINESS_EMAIL"
  else
    local urls
    urls="$(sql "
      SELECT r.\"fileUrl\" FROM \"Resume\" r JOIN \"User\" u ON u.id=r.\"userId\"
        WHERE u.email='${CANDIDATE_EMAIL}' AND r.\"fileUrl\" IS NOT NULL
      UNION
      SELECT af.\"fileUrl\" FROM \"ApplicationFile\" af
        JOIN \"Application\" a ON a.id=af.\"applicationId\"
        JOIN \"User\" u ON u.id=a.\"userId\" WHERE u.email='${CANDIDATE_EMAIL}';" 2>/dev/null || true)"
    sql "DELETE FROM \"User\" WHERE email='${CANDIDATE_EMAIL}'; DELETE FROM \"Business\" WHERE email='${BUSINESS_EMAIL}';" >/dev/null 2>&1 || true
    while IFS= read -r url; do
      local filename="${url##*/}"
      if [[ "$filename" =~ ^[0-9a-f-]+\.(pdf|docx|png|jpg|webp)$ ]]; then
        docker exec "$API_CONTAINER" rm -f "/repo/apps/api/uploads/$filename" >/dev/null 2>&1 || true
      fi
    done <<< "$urls"
  fi
  rm -rf "$WORK_DIR"
  exit "$exit_code"
}
trap cleanup EXIT

python3 - "$CV_PATH" <<'PY'
import sys, zipfile
from xml.sax.saxutils import escape

path = sys.argv[1]
lines = [
    "AISE End-to-End Candidate",
    "Senior TypeScript Backend Engineer",
    "Baku, Azerbaijan",
    "TypeScript, Node.js, NestJS, PostgreSQL, Redis, Docker",
    "Built reliable APIs, queues, and production deployment workflows.",
]
paragraphs = "".join(f"<w:p><w:r><w:t>{escape(line)}</w:t></w:r></w:p>" for line in lines)
content_types = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
document = f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{paragraphs}<w:sectPr/></w:body></w:document>'
with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as out:
    out.writestr("[Content_Types].xml", content_types)
    out.writestr("_rels/.rels", rels)
    out.writestr("word/document.xml", document)
PY

log "Candidate registration, verification, login and CV upload"
post_json '/auth/register' "$(jq -nc --arg email "$CANDIDATE_EMAIL" --arg password "$PASSWORD" '{email:$email,password:$password,acceptTerms:true}')" >/dev/null
echo "    registration: ok"
CANDIDATE_VERIFY_TOKEN="$(sql "SELECT vt.token FROM \"VerificationToken\" vt JOIN \"User\" u ON u.id=vt.\"userId\" WHERE u.email='${CANDIDATE_EMAIL}' AND vt.purpose='EMAIL_VERIFY' ORDER BY vt.\"createdAt\" DESC LIMIT 1;")"
[ -n "$CANDIDATE_VERIFY_TOKEN" ] || fail 'candidate verification token was not created'
post_json '/auth/verify-email' "$(jq -nc --arg token "$CANDIDATE_VERIFY_TOKEN" '{token:$token}')" >/dev/null
echo "    email verification: ok"
CANDIDATE_LOGIN="$(post_json '/auth/login' "$(jq -nc --arg email "$CANDIDATE_EMAIL" --arg password "$PASSWORD" '{email:$email,password:$password}')")"
CANDIDATE_TOKEN="$(jq -er '.sessionToken' <<< "$CANDIDATE_LOGIN")"
AUTH_HEADER=(-H "Authorization: Bearer $CANDIDATE_TOKEN")
echo "    login: ok"

BASE_RESUME="$(curl --fail-with-body -sS -X POST "${API_URL}/resumes" "${AUTH_HEADER[@]}" -F "file=@${CV_PATH};type=application/vnd.openxmlformats-officedocument.wordprocessingml.document")"
BASE_RESUME_ID="$(jq -er '.id' <<< "$BASE_RESUME")"
jq -e '.isBase == true and .status == "READY" and (.fileUrl | startswith("/uploads/"))' <<< "$BASE_RESUME" >/dev/null || fail 'base CV upload did not become READY'
echo "    CV upload: ok"

PROFILE_BODY="$(jq -nc '{name:"AISE E2E Candidate",headline:"Senior TypeScript Backend Engineer",skills:["TypeScript","Node.js","NestJS","PostgreSQL","Redis","Docker"],location:"Baku",jobPreferences:{roles:["Backend Engineer"],locations:["Baku","Remote"],types:["hybrid"]},phone:"+994501112233",experiences:[{title:"Senior Backend Engineer",company:"AISE Test Lab",startDate:"2022-01-01",description:"Built TypeScript, NestJS, PostgreSQL, Redis and Docker systems."}],education:[]}')"
patch_json '/profile' "$PROFILE_BODY" "${AUTH_HEADER[@]}" >/dev/null
echo "    profile: ok"

FREE_PLAN="$(get_json '/billing/subscription' "${AUTH_HEADER[@]}" | jq -er '.plan')"
[ "$FREE_PLAN" = 'FREE' ] || fail "new candidate did not start on FREE plan (got $FREE_PLAN)"
# Test setup: avoid pre-existing jobs consuming the synthetic account's three-match FREE quota.
sql "UPDATE \"Subscription\" s SET plan='Limitsiz' FROM \"User\" u WHERE s.\"userId\"=u.id AND u.email='${CANDIDATE_EMAIL}';" >/dev/null

log "Business registration, verification, approval and vacancy creation"
post_json '/business/auth/register' "$(jq -nc --arg email "$BUSINESS_EMAIL" --arg password "$PASSWORD" '{email:$email,password:$password,companyName:"AISE E2E Company"}')" >/dev/null
BUSINESS_VERIFY_TOKEN="$(sql "SELECT vt.token FROM \"BusinessVerificationToken\" vt JOIN \"Business\" b ON b.id=vt.\"businessId\" WHERE b.email='${BUSINESS_EMAIL}' AND vt.purpose='EMAIL_VERIFY' ORDER BY vt.\"createdAt\" DESC LIMIT 1;")"
[ -n "$BUSINESS_VERIFY_TOKEN" ] || fail 'business verification token was not created'
post_json '/business/auth/verify-email' "$(jq -nc --arg token "$BUSINESS_VERIFY_TOKEN" '{token:$token}')" >/dev/null
sql "UPDATE \"Company\" c SET status='APPROVED' FROM \"Business\" b WHERE c.\"businessId\"=b.id AND b.email='${BUSINESS_EMAIL}';" >/dev/null
BUSINESS_LOGIN="$(post_json '/business/auth/login' "$(jq -nc --arg email "$BUSINESS_EMAIL" --arg password "$PASSWORD" '{email:$email,password:$password}')")"
BUSINESS_TOKEN="$(jq -er '.sessionToken' <<< "$BUSINESS_LOGIN")"
BUSINESS_AUTH_HEADER=(-H "Authorization: Bearer $BUSINESS_TOKEN")

VACANCY_BODY="$(jq -nc '{title:"Senior TypeScript Backend Engineer",description:"Build reliable TypeScript and NestJS APIs backed by PostgreSQL and Redis.",responsibilities:"Own APIs, queues and production reliability.",requirements:"Strong TypeScript, Node.js, NestJS, PostgreSQL, Redis and Docker experience.",skills:["TypeScript","Node.js","NestJS","PostgreSQL","Redis","Docker"],experienceLevel:"Senior",location:"Baku",workArrangement:"Hybrid",employmentType:"Full-time",questions:[{label:"Why AISE?",type:"LONG_TEXT",required:true,order:0},{label:"Supporting document",type:"FILE_UPLOAD",required:true,order:1}]}')"
VACANCY="$(post_json '/business/vacancies' "$VACANCY_BODY" "${BUSINESS_AUTH_HEADER[@]}")"
VACANCY_ID="$(jq -er '.id' <<< "$VACANCY")"
TEXT_QUESTION_ID="$(jq -er '.questions[] | select(.type == "LONG_TEXT") | .id' <<< "$VACANCY")"
FILE_QUESTION_ID="$(jq -er '.questions[] | select(.type == "FILE_UPLOAD") | .id' <<< "$VACANCY")"

log "Onboarding completion and asynchronous matching"
post_json '/profile/complete-onboarding' '{}' "${AUTH_HEADER[@]}" >/dev/null
MATCH_ID=''
for _ in $(seq 1 60); do
  MATCHES="$(get_json '/matches' "${AUTH_HEADER[@]}")"
  MATCH_ID="$(jq -r --arg vacancy "$VACANCY_ID" '.[] | select(.vacancyId == $vacancy) | .id' <<< "$MATCHES" | head -n1)"
  [ -n "$MATCH_ID" ] && break
  sleep 3
done
[ -n "$MATCH_ID" ] || fail 'matching did not create a match for the synthetic vacancy within 180 seconds'

log "AI-tailored CV generation and authenticated download"
TAILORED="$(post_json '/resumes/tailor' "$(jq -nc --arg matchId "$MATCH_ID" --arg baseResumeId "$BASE_RESUME_ID" '{matchId:$matchId,baseResumeId:$baseResumeId}')" "${AUTH_HEADER[@]}")"
TAILORED_ID="$(jq -er '.id' <<< "$TAILORED")"
TAILORED_URL=''
for _ in $(seq 1 72); do
  RESUMES="$(get_json '/resumes' "${AUTH_HEADER[@]}")"
  STATUS="$(jq -r --arg id "$TAILORED_ID" '.[] | select(.id == $id) | .status' <<< "$RESUMES")"
  if [ "$STATUS" = 'READY' ]; then
    TAILORED_URL="$(jq -er --arg id "$TAILORED_ID" '.[] | select(.id == $id) | .fileUrl' <<< "$RESUMES")"
    break
  fi
  [ "$STATUS" = 'FAILED' ] && fail "tailored CV generation failed: $(jq -r --arg id "$TAILORED_ID" '.[] | select(.id == $id) | .statusError' <<< "$RESUMES")"
  sleep 5
done
[ -n "$TAILORED_URL" ] || fail 'tailored CV did not become READY within 360 seconds'
TAILORED_FILE="$WORK_DIR/tailored.pdf"
curl --fail-with-body -sS "${API_URL}${TAILORED_URL}" "${AUTH_HEADER[@]}" -o "$TAILORED_FILE"
[ -s "$TAILORED_FILE" ] || fail 'tailored CV download was empty'

log "Native application with required text and file answers"
ANSWERS="$(jq -nc --arg questionId "$TEXT_QUESTION_ID" '[{questionId:$questionId,value:"AISE solves a real hiring workflow problem."}]')"
FILE_QUESTION_IDS="$(jq -nc --arg questionId "$FILE_QUESTION_ID" '[$questionId]')"
APPLICATION="$(curl --fail-with-body -sS -X POST "${API_URL}/vacancies/${VACANCY_ID}/apply" "${AUTH_HEADER[@]}" \
  -F "answers=${ANSWERS}" -F "fileQuestionIds=${FILE_QUESTION_IDS}" \
  -F "files=@${CV_PATH};type=application/vnd.openxmlformats-officedocument.wordprocessingml.document")"
APPLICATION_ID="$(jq -er '.id' <<< "$APPLICATION")"

EMPLOYER_DETAIL="$(get_json "/business/applications/${APPLICATION_ID}" "${BUSINESS_AUTH_HEADER[@]}")"
jq -e '.resumeUrl != null and ([.answers[] | select(.fileUrl != null)] | length == 1)' <<< "$EMPLOYER_DETAIL" >/dev/null || fail 'employer could not see the base CV and uploaded answer file'
patch_json "/business/applications/${APPLICATION_ID}/status" '{"status":"INTERVIEW"}' "${BUSINESS_AUTH_HEADER[@]}" >/dev/null
CANDIDATE_APPLICATIONS="$(get_json '/dashboard/applications' "${AUTH_HEADER[@]}")"
jq -e --arg id "$APPLICATION_ID" '.[] | select(.id == $id and .status == "INTERVIEW")' <<< "$CANDIDATE_APPLICATIONS" >/dev/null || fail 'candidate did not see the employer status update'

log "Vacancy pause/reactivate controls"
patch_json "/business/vacancies/${VACANCY_ID}/pause" '{}' "${BUSINESS_AUTH_HEADER[@]}" >/dev/null
PAUSED_STATUS="$(get_json "/business/vacancies/${VACANCY_ID}" "${BUSINESS_AUTH_HEADER[@]}" | jq -er '.status')"
[ "$PAUSED_STATUS" = 'PAUSED' ] || fail 'vacancy did not pause'
patch_json "/business/vacancies/${VACANCY_ID}/reactivate" '{}' "${BUSINESS_AUTH_HEADER[@]}" >/dev/null
ACTIVE_STATUS="$(get_json "/business/vacancies/${VACANCY_ID}" "${BUSINESS_AUTH_HEADER[@]}" | jq -er '.status')"
[ "$ACTIVE_STATUS" = 'ACTIVE' ] || fail 'vacancy did not reactivate'

log "E2E PASSED"
printf 'candidate auth + CV + onboarding: PASS\n'
printf 'business auth + vacancy lifecycle: PASS\n'
printf 'matching + tailored CV download: PASS\n'
printf 'native apply + employer review/status: PASS\n'
printf 'subscription entitlement read: PASS\n'
