#!/usr/bin/env bash
#
# Idempotent, non-printing edits to the production environment files.
#
#   scripts/host-config.sh mfa-key       # add ADMIN_MFA_ENCRYPTION_KEY to apps/api/.env if absent (32 random bytes, base64)
#   scripts/host-config.sh payments-off  # set PAYMENTS_ENABLED=false in apps/api/.env (refuses to overwrite "true")
#   scripts/host-config.sh documents-off # set DOCUMENT_GENERATION_ENABLED=false in apps/api/.env: document generation answers "unavailable" until the real provider has been evaluated (refuses to overwrite "true")
#   scripts/host-config.sh flag NAME true|false  # deliberate switch of a launch flag (payments, documents, sources, assisted browser agent, Azerbaijani writer or candidate-approved email); previous values are kept privately
#   scripts/host-config.sh app-env       # set APP_ENV=production in .env if absent
#   scripts/host-config.sh secure-files  # deploy user owns the three secret files, mode 600 — no sudo needed (see below)
#   scripts/host-config.sh web-env       # apps/web/.env.local keeps only NEXT_PUBLIC_* (server secrets are not build inputs)
#   scripts/host-config.sh backup-status # BACKUP_STATUS_DIR in .env = the directory backup-daily.sh writes status to
#   scripts/host-config.sh preflight     # must pass BEFORE the new API starts: prints PASS/FAIL, exit 1 on any FAIL
#
# secure-files: the files are root-owned 0644 inside directories the deploy user owns. A directory owner
# may replace a file in it, so each file is copied to a private temp file (mode 600, owned by the deploy
# user) and renamed over the original — same content, new owner and mode, no privilege needed or used.

# Each change backs the file up first (mode 600) and leaves it mode 600. No
# secret is printed. After `mfa-key` the key exists ONLY in apps/api/.env: copy it
# into the founder's password manager immediately (see docs/host-hardening-and-backups.md),
# because losing it disables every enrolled authenticator (recovery:
# npm run script:admin-recover:prod).
# Requires the deploy user to own the files (scripts/check-host-security.sh).
#
set -euo pipefail
AISE_DIR="${AISE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$AISE_DIR"

has_key() { grep -q "^$2=" "$1" 2>/dev/null; }
edit() { # file KEY VALUE  (replace or append)
  local file="$1" key="$2" value="$3" tmp
  [ -w "$file" ] || { echo "$file is not writable by $(id -un) — fix ownership first" >&2; exit 1; }
  cp -p "$file" "$file.bak.$(date -u +%Y%m%dT%H%M%SZ)" && chmod 600 "$file.bak."*
  tmp="$(mktemp "$file.XXXXXX")"; chmod 600 "$tmp"
  { grep -v "^$key=" "$file" || true; printf '%s=%s\n' "$key" "$value"; } > "$tmp" && mv "$tmp" "$file"
}

SECRET_FILES=(.env apps/api/.env apps/web/.env.local)
mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
owner_of() { stat -c '%U' "$1" 2>/dev/null || stat -f '%Su' "$1"; }

case "${1:-}" in
  secure-files)
    for f in "${SECRET_FILES[@]}"; do
      [ -e "$f" ] || { echo "skip $f (absent)"; continue; }
      if [ "$(owner_of "$f")" = "$(id -un)" ] && [ "$(mode_of "$f")" = "600" ]; then echo "ok   $f already $(id -un) 600"; continue; fi
      [ -r "$f" ] || { echo "$f is not readable by $(id -un); cannot copy it" >&2; exit 1; }
      [ -w "$(dirname "$f")" ] || { echo "$(dirname "$f") is not writable by $(id -un); this step then needs the operator's sudo" >&2; exit 1; }
      tmp="$(umask 077; mktemp "$f.XXXXXX")"
      cat "$f" > "$tmp" && chmod 600 "$tmp" && mv -f "$tmp" "$f" || { rm -f "$tmp"; echo "could not replace $f" >&2; exit 1; }
      echo "done $f -> $(owner_of "$f") $(mode_of "$f")"
    done
    docker compose config -q && echo "docker compose config -q: ok"
    ;;
  web-env)
    f=apps/web/.env.local
    [ -f "$f" ] || { echo "no $f"; exit 0; }
    if ! grep -E '^[A-Za-z_]+=' "$f" | cut -d= -f1 | grep -qv '^NEXT_PUBLIC_'; then echo "$f already holds only NEXT_PUBLIC_* values"; exit 0; fi
    [ -w "$f" ] || { echo "$f is not writable by $(id -un) — run secure-files first" >&2; exit 1; }
    cp -p "$f" "$f.bak.$(date -u +%Y%m%dT%H%M%SZ)" && chmod 600 "$f.bak."*
    tmp="$(umask 077; mktemp "$f.XXXXXX")"
    # Keep comments, blank lines and every NEXT_PUBLIC_* assignment (public by definition, even when the name ends in _KEY); drop any other assignment.
    awk '/^[A-Za-z_][A-Za-z0-9_]*=/ && !/^NEXT_PUBLIC_/ {next} {print}' "$f" > "$tmp" && chmod 600 "$tmp" && mv -f "$tmp" "$f"
    grep -E '^[A-Za-z_]+=' "$f" | cut -d= -f1 | grep -qv '^NEXT_PUBLIC_' && { echo "$f still holds a non-public variable; edit it by hand" >&2; exit 1; }
    echo "$f now holds only NEXT_PUBLIC_* values (previous copy kept, mode 600)"
    ;;
  backup-status)
    dir="${BACKUP_STATUS_DIR:-$HOME/aise-backups/status}"
    mkdir -p "$dir"; [ -d "$dir" ] && [ -r "$dir" ] || { echo "$dir is not a readable directory" >&2; exit 1; }
    edit .env BACKUP_STATUS_DIR "$dir"
    echo "BACKUP_STATUS_DIR set in .env (recreate the API to apply)"
    ;;
  preflight)
    FAILS=0; chk() { if "${@:2}" >/dev/null 2>&1; then echo "PASS  $1"; else echo "FAIL  $1"; FAILS=$((FAILS+1)); fi; }
    val() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n 1 | sed -e 's/^"//' -e 's/"$//'; }
    for f in "${SECRET_FILES[@]}"; do [ -e "$f" ] && chk "$f owned by $(id -un), mode 600" test "$(owner_of "$f")" = "$(id -un)" -a "$(mode_of "$f")" = "600"; done
    chk "docker compose config -q" docker compose config -q
    # Both flags default to "off"; a launch step that enables one states it explicitly (EXPECT_PAYMENTS=true / EXPECT_DOCUMENTS=true). Unset never counts as on.
    chk "PAYMENTS_ENABLED is exactly ${EXPECT_PAYMENTS:-false}" test "$(val apps/api/.env PAYMENTS_ENABLED)" = "${EXPECT_PAYMENTS:-false}"
    chk "DOCUMENT_GENERATION_ENABLED is exactly ${EXPECT_DOCUMENTS:-false} (on only after the real-model pilot and the founder's recorded decision)" test "$(val apps/api/.env DOCUMENT_GENERATION_ENABLED)" = "${EXPECT_DOCUMENTS:-false}"
    chk "browser agent: autonomous mode is not enabled (no portal is verified for it)" test "$(val apps/api/.env BROWSER_AGENT_AUTONOMOUS_ENABLED)" != "true"
    chk "browser agent switch is exactly ${EXPECT_AGENT:-false} or unset when off" test "$(val apps/api/.env BROWSER_AGENT_ENABLED)" = "${EXPECT_AGENT:-false}" -o "${EXPECT_AGENT:-false}" = "false" -a -z "$(val apps/api/.env BROWSER_AGENT_ENABLED)"
    # Employer plans and employer billing are off until the checkout, webhook and publication behaviour have been verified; unset counts as off.
    chk "employer plans switch is exactly ${EXPECT_EMPLOYER_PLANS:-false} (unset = off)" test "$(val apps/api/.env EMPLOYER_PLANS_ENABLED)" = "${EXPECT_EMPLOYER_PLANS:-false}" -o "${EXPECT_EMPLOYER_PLANS:-false}" = "false" -a -z "$(val apps/api/.env EMPLOYER_PLANS_ENABLED)"
    chk "employer billing switch is exactly ${EXPECT_EMPLOYER_BILLING:-false} (unset = off)" test "$(val apps/api/.env EMPLOYER_BILLING_ENABLED)" = "${EXPECT_EMPLOYER_BILLING:-false}" -o "${EXPECT_EMPLOYER_BILLING:-false}" = "false" -a -z "$(val apps/api/.env EMPLOYER_BILLING_ENABLED)"
    chk "external live auto-apply is not enabled" test "$(val apps/api/.env EXTERNAL_APPLY_LIVE_ENABLED)" != "true" -a "$(val .env EXTERNAL_APPLY_LIVE_ENABLED)" != "true"
    chk "ADMIN_MFA_ENCRYPTION_KEY is set and decodes to 32 bytes" test "$(printf %s "$(val apps/api/.env ADMIN_MFA_ENCRYPTION_KEY)" | base64 -d 2>/dev/null | wc -c | tr -d ' ')" = 32
    chk "BACKUP_STATUS_DIR is set to a readable directory" test -n "$(val .env BACKUP_STATUS_DIR)" -a -r "$(val .env BACKUP_STATUS_DIR)"
    chk "web build inputs hold only NEXT_PUBLIC_*" test -z "$(grep -E '^[A-Za-z_]+=' apps/web/.env.local 2>/dev/null | cut -d= -f1 | grep -v '^NEXT_PUBLIC_')"
    [ "$FAILS" -eq 0 ] && echo "preflight: all checks passed — safe to recreate the API" || { echo "preflight: $FAILS check(s) FAILED — do not start the new API"; exit 1; }
    ;;
  mfa-key)
    f=apps/api/.env
    if has_key "$f" ADMIN_MFA_ENCRYPTION_KEY; then echo "ADMIN_MFA_ENCRYPTION_KEY is already set; not changing it (changing it would disable every enrolled authenticator)"; exit 0; fi
    key="$(openssl rand -base64 32)"
    [ "$(printf %s "$key" | base64 -d | wc -c | tr -d ' ')" = 32 ] || { echo "generated key is not 32 bytes" >&2; exit 1; }
    edit "$f" ADMIN_MFA_ENCRYPTION_KEY "$key"
    echo "ADMIN_MFA_ENCRYPTION_KEY added to $f. Recreate the API (docker compose up -d --no-deps api), then save the key in the password manager."
    ;;
  payments-off)
    f=apps/api/.env
    if grep -q '^PAYMENTS_ENABLED=true' "$f"; then echo "PAYMENTS_ENABLED is true; refusing to switch payments off silently — do it deliberately" >&2; exit 1; fi
    edit "$f" PAYMENTS_ENABLED false
    echo "PAYMENTS_ENABLED=false set in $f (recreate the API to apply)"
    ;;
  documents-off)
    f=apps/api/.env
    if grep -q '^DOCUMENT_GENERATION_ENABLED=true' "$f"; then echo "DOCUMENT_GENERATION_ENABLED is true; refusing to switch generation off silently — do it deliberately" >&2; exit 1; fi
    edit "$f" DOCUMENT_GENERATION_ENABLED false
    echo "DOCUMENT_GENERATION_ENABLED=false set in $f (recreate the API to apply; remove the line or set it to true after the real-model pilot)"
    ;;
  flag)
    name="${2:-}"; value="${3:-}"
    case "$name" in PAYMENTS_ENABLED|DOCUMENT_GENERATION_ENABLED|SOURCE_SCHEDULE_ENABLED|BROWSER_AGENT_ENABLED|TAILOR_AZ_WRITER|EMAIL_APPLY_ENABLED|EMPLOYER_PLANS_ENABLED|EMPLOYER_BILLING_ENABLED) ;; *) echo "flag: unsupported launch flag" >&2; exit 2 ;; esac
    case "$value" in true|false) ;; *) echo "flag: value must be exactly true or false" >&2; exit 2 ;; esac
    edit apps/api/.env "$name" "$value"
    echo "$name=$value set in apps/api/.env (previous copy kept, mode 600; recreate the API to apply)"
    ;;
  app-env)
    f=.env
    if has_key "$f" APP_ENV; then echo "APP_ENV already set"; exit 0; fi
    edit "$f" APP_ENV production
    echo "APP_ENV=production set in $f (recreate the API to apply)"
    ;;
  *) echo "usage: host-config.sh mfa-key|payments-off|documents-off|flag|app-env" >&2; exit 2 ;;
esac
