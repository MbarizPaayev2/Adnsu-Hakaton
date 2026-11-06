#!/usr/bin/env bash
#
# Read-only security verification for the AISE production host. Prints PASS /
# FAIL / SKIP per check (names and states only, never values) and exits 1 on any FAIL.
#
#   scripts/check-host-security.sh                 # run on the host, as the deploy user, in the checkout
#   scripts/check-host-security.sh --probe 100.x.y.z   # run from ANOTHER machine (tailnet/LAN): TCP connects only
#
# Checks: secret-file ownership and mode; `docker compose config -q` (the real
# test — `config --services` does not read env_file and passes even when
# apps/api/.env is unreadable); web build inputs carry no server secrets; the
# API container's runtime flags (payments in the explicitly expected state, MFA key present and
# 32 bytes, external apply not live, environment and release identified); every
# published port bound to 127.0.0.1; the well-known default database password
# is rejected.
#
set -uo pipefail
AISE_DIR="${AISE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
API_CONTAINER="${API_CONTAINER:-aise-api}"
DB_CONTAINER="${DB_CONTAINER:-aise-postgres}"
CONTAINER_PREFIX="${AISE_CONTAINER_PREFIX:-aise}"
DEFAULT_DB_PASSWORD="${DEFAULT_DB_PASSWORD:-postgrespassword}"
EXPECT_PAYMENTS="${EXPECT_PAYMENTS:-false}" # initial launch stays off unless a verified paid rollout is stated explicitly
case "$EXPECT_PAYMENTS" in true|false) ;; *) printf 'EXPECT_PAYMENTS must be true or false\n' >&2; exit 2 ;; esac
FAILS=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS+1)); }
skip() { printf 'SKIP  %s\n' "$*"; }

if [ "${1:-}" = "--probe" ]; then
  host="${2:?usage: --probe <host-or-ip>}"
  for port in ${PROBE_PORTS:-3000 4000 5433 6379 8000 8100}; do
    if nc -z -G 3 "$host" "$port" >/dev/null 2>&1 || nc -z -w 3 "$host" "$port" >/dev/null 2>&1; then
      fail "$host:$port accepts connections — it must be loopback-only"
    else
      pass "$host:$port closed"
    fi
  done
  [ "$FAILS" -eq 0 ]; exit $?
fi

cd "$AISE_DIR" || { echo "no such directory $AISE_DIR"; exit 2; }
ME="$(id -un)"

# ---- 1. secret files: owned by the deploy user, private ------------------------
mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
owner_of() { stat -c '%U' "$1" 2>/dev/null || stat -f '%Su' "$1"; }
for f in .env apps/api/.env apps/web/.env.local; do
  [ -e "$f" ] || { skip "$f does not exist"; continue; }
  o="$(owner_of "$f")"; m="$(mode_of "$f")"
  if [ "$o" = "$ME" ] && [ "$m" = "600" ]; then pass "$f owned by $ME, mode 600"; else fail "$f is $o:$m (want $ME, 600)"; fi
done

# ---- 2. compose really reads the secret files ---------------------------------
if command -v docker >/dev/null && docker compose config -q >/dev/null 2>&1; then pass "docker compose config -q"; else fail "docker compose config -q failed (unreadable env_file or missing required variable)"; fi

# ---- 3. web build inputs carry no server secrets ------------------------------
if [ -f apps/web/.env.local ]; then
  bad="$(grep -E '^[A-Za-z_]+=' apps/web/.env.local | cut -d= -f1 | grep -v '^NEXT_PUBLIC_' || true)"
  if [ -z "$bad" ]; then pass "apps/web/.env.local holds only NEXT_PUBLIC_* values"; else fail "apps/web/.env.local holds non-public variable(s): $(echo $bad | tr '\n' ' ')"; fi
fi

# ---- 4. runtime flags in the running API --------------------------------------
if command -v docker >/dev/null && docker inspect "$API_CONTAINER" >/dev/null 2>&1; then
  envof() { docker exec "$API_CONTAINER" printenv "$1" 2>/dev/null; }
  [ -n "$(envof APP_ENV)" ] && pass "APP_ENV is set ($(envof APP_ENV))" || fail "APP_ENV is not set"
  [ -n "$(envof RELEASE_SHA)" ] && pass "RELEASE_SHA is set" || fail "RELEASE_SHA is not set (deploy.sh sets it)"
  [ "$(envof PAYMENTS_ENABLED)" = "$EXPECT_PAYMENTS" ] && pass "PAYMENTS_ENABLED=$EXPECT_PAYMENTS (explicit intended state)" || fail "PAYMENTS_ENABLED does not match the explicit intended value $EXPECT_PAYMENTS"
  # Employer billing is a paid offer: on only when the verified rollout says so explicitly (EXPECT_EMPLOYER_BILLING=true), never by accident.
  eb="$(envof EMPLOYER_BILLING_ENABLED)"; eb="${eb:-false}"
  [ "$eb" = "${EXPECT_EMPLOYER_BILLING:-false}" ] && pass "EMPLOYER_BILLING_ENABLED=$eb (explicit intended state)" || fail "EMPLOYER_BILLING_ENABLED=$eb does not match the explicit intended value ${EXPECT_EMPLOYER_BILLING:-false}"
  [ "$(envof EXTERNAL_APPLY_LIVE_ENABLED)" = "true" ] && fail "EXTERNAL_APPLY_LIVE_ENABLED is true (live external submission must stay off)" || pass "external live submission is not enabled"
  if docker exec "$API_CONTAINER" sh -c 'k="$ADMIN_MFA_ENCRYPTION_KEY"; [ -n "$k" ] && [ "$(printf %s "$k" | base64 -d 2>/dev/null | wc -c | tr -d " ")" = 32 ]' >/dev/null 2>&1; then pass "ADMIN_MFA_ENCRYPTION_KEY is set and decodes to 32 bytes"; else fail "ADMIN_MFA_ENCRYPTION_KEY is missing or not 32 base64-decoded bytes"; fi
else
  skip "API container $API_CONTAINER not running here"
fi

# ---- 5. published ports are loopback-only -------------------------------------
if command -v docker >/dev/null; then
  exposed="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "^$CONTAINER_PREFIX" | grep -E '0\.0\.0\.0:|\[::\]:' || true)"
  if [ -z "$exposed" ]; then pass "no AISE container publishes a port on all interfaces"; else fail "published on all interfaces: $(echo "$exposed" | cut -d' ' -f1 | tr '\n' ' ')"; fi
fi

# ---- 6. the default database password no longer works -------------------------
if command -v docker >/dev/null && docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  net="$(docker inspect "$DB_CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')"
  host="$(docker inspect "$DB_CONTAINER" --format '{{.Name}}' | tr -d '/')"
  if docker run --rm --network "$net" -e PGPASSWORD="$DEFAULT_DB_PASSWORD" -e PGCONNECT_TIMEOUT=5 postgres:15-alpine \
       psql -h "$host" -U postgres -d aise -At -c 'select 1' >/dev/null 2>&1; then
    fail "the database accepts the default password — rotate it (scripts/rotate-db-password.sh)"
  else
    pass "the default database password is rejected"
  fi
else
  skip "database container $DB_CONTAINER not running here"
fi

echo
[ "$FAILS" -eq 0 ] && echo "host security: all checks passed" || echo "host security: $FAILS check(s) FAILED"
[ "$FAILS" -eq 0 ]
