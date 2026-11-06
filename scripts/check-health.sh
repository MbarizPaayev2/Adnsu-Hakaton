#!/usr/bin/env bash
#
# Host-side monitor for the AISE stack. Run from cron, e.g. every 15 minutes:
#
#   */15 * * * * /opt/aise/scripts/check-health.sh >> /var/log/aise-health.log 2>&1
#
# Prints one line per check and exits non-zero when anything needs action, so
# cron's MAILTO (or ALERT_WEBHOOK_URL below) turns a failure into an alert.
# It only reads: the API readiness probe, the backup status file written by
# scripts/backup.sh / restore-test.sh, and free disk space. It never restarts,
# deploys or changes anything.
#
set -uo pipefail

API_URL="${API_URL:-http://127.0.0.1:4000}"
STATUS_FILE="${STATUS_FILE:-/var/backups/aise/status/status.json}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-26}"
MAX_RESTORE_AGE_DAYS="${MAX_RESTORE_AGE_DAYS:-8}"
MIN_FREE_DISK_PCT="${MIN_FREE_DISK_PCT:-15}"
DISK_PATH="${DISK_PATH:-/}"
# Outbound e-mail health: the API logs "[EMAIL ERROR]" when every attempt to send failed (a revoked key, an unverified domain). Without this
# check such an outage is silent (verification, reset and digest mails stop and nothing else turns red).
DOCKER="${DOCKER:-docker}"
API_CONTAINER="${API_CONTAINER:-aise-api}"
EMAIL_ERROR_WINDOW_HOURS="${EMAIL_ERROR_WINDOW_HOURS:-6}"
MAX_EMAIL_ERRORS="${MAX_EMAIL_ERRORS:-0}"
# Vacancy-source health (read-only SQL in the database container). Staleness follows each source's own schedule: a source run by the scheduler may go
# 2 x its interval + 60 min without a finished SUCCEEDED/PARTIAL run (a daily source is therefore not alarmed after 6 h); the sources listed in
# SOURCE_HOURLY_KEYS (Glorri's own importer, hourly, whatever its registry interval says) may go SOURCE_HOURLY_STALE_HOURS. SOURCE_STALE_HOURS, when set,
# forces one threshold for every source (used to test the alert). A source in cooldown and any scheduled source OUTSIDE the allowlist are problems too (the
# allowlist is what production is meant to collect: nothing else may be scheduled without a decision).
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-aise-postgres}"
SOURCE_STALE_HOURS="${SOURCE_STALE_HOURS:-}"
SOURCE_HOURLY_KEYS="${SOURCE_HOURLY_KEYS:-glorri}"
SOURCE_HOURLY_STALE_HOURS="${SOURCE_HOURLY_STALE_HOURS:-3}"
SOURCE_ALLOWLIST="${SOURCE_ALLOWLIST:-glorri}"
MAX_OFFHOST_AGE_HOURS="${MAX_OFFHOST_AGE_HOURS:-26}"
# Optional: a URL that accepts a JSON POST ({"text": "..."}), e.g. a chat
# webhook the owner controls. Unset = rely on cron mail / the log only.
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
# Optional: an Uptime Kuma "Push" monitor URL (already running on this host).
# Every run reports up/down to it, so Kuma alerts on a reported problem AND on
# silence (cron stopped, host down) — a dead-man's switch. The message carries
# short problem labels only; never secrets or data.
UPTIME_KUMA_PUSH_URL="${UPTIME_KUMA_PUSH_URL:-}"
# Optional: email alerts through Resend, the mail service AISE already uses. The key is read from the API's
# own env file at send time (never printed or logged); the message carries the short problem labels only.
# The same set of problems is emailed at most once per ALERT_EMAIL_MIN_HOURS, and a recovery is emailed once.
ALERT_EMAIL_TO="${ALERT_EMAIL_TO:-}"
ALERT_EMAIL_FROM="${ALERT_EMAIL_FROM:-AISE monitor <noreply@aisehr.com>}"
RESEND_ENV_FILE="${RESEND_ENV_FILE:-/srv/stacks/aise/apps/api/.env}"
RESEND_API_URL="${RESEND_API_URL:-https://api.resend.com/emails}"
ALERT_EMAIL_MIN_HOURS="${ALERT_EMAIL_MIN_HOURS:-6}"
ALERT_STATE_FILE="${ALERT_STATE_FILE:-$(dirname "$STATUS_FILE")/alert-state}"

PROBLEMS=()
ok()      { printf 'OK    %s\n' "$*"; }
problem() { printf 'ALERT %s\n' "$*"; PROBLEMS+=("$*"); }

age_hours() { # ISO-8601 UTC timestamp -> whole hours ago, or empty
  local at="$1" then
  [ -z "$at" ] && return 0
  then=$(date -u -d "$at" +%s 2>/dev/null) || return 0
  echo $(( ($(date -u +%s) - then) / 3600 ))
}
field() { sed -n "s/.*\"$1\": *\"\\([^\"]*\\)\".*/\\1/p" "$STATUS_FILE"; }

# ---------------------------------------------------------------- readiness --
READY="$(curl -fsS --max-time 10 "$API_URL/health/ready" 2>/dev/null)"
if [ -n "$READY" ] && printf '%s' "$READY" | grep -q '"status":"ok"'; then
  ok "API ready ($(printf '%s' "$READY" | sed -n 's/.*"release":"\{0,1\}\([^",}]*\).*/release \1/p'))"
else
  problem "API not ready at $API_URL/health/ready (${READY:-no answer}) — docker compose ps; docker compose logs --tail 100 api"
fi

# ------------------------------------------------------------------- backups --
if [ ! -f "$STATUS_FILE" ]; then
  problem "no backup status file at $STATUS_FILE — scripts/backup.sh has never completed on this host"
else
  B_AGE="$(age_hours "$(field lastBackupAt)")"
  if [ -z "$B_AGE" ]; then
    problem "no successful backup recorded — run scripts/backup.sh"
  elif [ "$B_AGE" -gt "$MAX_BACKUP_AGE_HOURS" ]; then
    problem "last backup is ${B_AGE}h old (limit ${MAX_BACKUP_AGE_HOURS}h) — check the backup cron job"
  else
    ok "last backup ${B_AGE}h ago"
  fi

  # A failure recorded after the last success means tonight's backup did not happen.
  F_AT="$(field lastBackupFailureAt)"
  if [ -n "$F_AT" ]; then
    problem "backup job failed at $F_AT: $(field lastBackupError)"
  fi

  O_AGE="$(age_hours "$(field lastOffhostCopyAt)")"
  if [ -z "$O_AGE" ]; then
    problem "no verified off-host copy recorded — backups exist only on this host (scripts/offhost-sync.sh)"
  elif [ "$(field lastOffhostResult)" != "VERIFIED" ]; then
    problem "last off-host copy result is $(field lastOffhostResult) — $(field lastOffhostError)"
  elif [ "$O_AGE" -gt "$MAX_OFFHOST_AGE_HOURS" ]; then
    problem "last verified off-host copy is ${O_AGE}h old (limit ${MAX_OFFHOST_AGE_HOURS}h)"
  elif [ "$(field lastOffhostDestination)" != "bucket" ]; then
    problem "the verified off-host copy is on '$(field lastOffhostDestination)', not the durable bucket — a laptop is not durable storage; configure the bucket (docs/host-hardening-and-backups.md §E)"
  else
    ok "off-host copy verified ${O_AGE}h ago"
  fi

  R_AGE="$(age_hours "$(field lastRestoreTestAt)")"
  R_RESULT="$(field lastRestoreTestResult)"
  if [ -z "$R_AGE" ] || [ "$R_RESULT" != "PASSED" ]; then
    problem "no passing restore test recorded — run scripts/restore-test.sh on the latest backup"
  elif [ "$R_AGE" -gt $((MAX_RESTORE_AGE_DAYS * 24)) ]; then
    problem "last passing restore test is $((R_AGE / 24)) days old (limit ${MAX_RESTORE_AGE_DAYS}) — run scripts/restore-test.sh"
  else
    ok "restore test PASSED $((R_AGE / 24)) day(s) ago"
  fi
fi

# ---------------------------------------------------------------------- disk --
FREE_PCT=$(df -P "$DISK_PATH" | awk 'NR==2 {gsub("%","",$5); print 100-$5}')
if [ -n "$FREE_PCT" ] && [ "$FREE_PCT" -lt "$MIN_FREE_DISK_PCT" ]; then
  problem "only ${FREE_PCT}% disk free on $DISK_PATH (limit ${MIN_FREE_DISK_PCT}%) — old images: docker image prune; old local backups: see RETAIN_DAYS"
else
  ok "${FREE_PCT}% disk free on $DISK_PATH"
fi

# ---------------------------------------------------------------- outbound mail --
if command -v "$DOCKER" >/dev/null 2>&1 && "$DOCKER" inspect "$API_CONTAINER" >/dev/null 2>&1; then
  EMAIL_ERRORS=$("$DOCKER" logs --since "${EMAIL_ERROR_WINDOW_HOURS}h" "$API_CONTAINER" 2>&1 | grep -c '\[EMAIL ERROR\]' || true)
  if [ "${EMAIL_ERRORS:-0}" -gt "$MAX_EMAIL_ERRORS" ]; then
    problem "outbound e-mail failing: ${EMAIL_ERRORS} send failure(s) in the last ${EMAIL_ERROR_WINDOW_HOURS} h (sending key or domain verification) — users may not receive verification or reset mail"
  else
    ok "no outbound e-mail failures in the last ${EMAIL_ERROR_WINDOW_HOURS} h"
  fi
fi

# ------------------------------------------------------------------- sources --
if command -v "$DOCKER" >/dev/null 2>&1 && "$DOCKER" inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 && [[ "${SOURCE_STALE_HOURS:-0}" =~ ^[0-9]+$ ]] && [[ "$SOURCE_HOURLY_STALE_HOURS" =~ ^[0-9]+$ ]] && [[ "$SOURCE_ALLOWLIST" =~ ^[a-z0-9,-]+$ ]] && [[ "$SOURCE_HOURLY_KEYS" =~ ^[a-z0-9,-]*$ ]]; then
  if [ -n "$SOURCE_STALE_HOURS" ]; then ALLOWED_MIN="$((SOURCE_STALE_HOURS * 60))"; else ALLOWED_MIN="CASE WHEN s.key = ANY(string_to_array('${SOURCE_HOURLY_KEYS}', ',')) THEN ${SOURCE_HOURLY_STALE_HOURS} * 60 ELSE s.\"intervalMinutes\" * 2 + 60 END"; fi
  SOURCE_SQL="select 'stale', s.key, coalesce(to_char(max(r.\"finishedAt\"), 'MM-DD HH24:MI'), 'never (scheduled ' || coalesce(to_char((select max(a.\"createdAt\") from \"AdminAuditLog\" a where a.action = 'SOURCE_SCHEDULE_CHANGED' and a.\"targetId\" = s.key), 'MM-DD HH24:MI'), 'unknown') || ')') || ' (allowed ' || (${ALLOWED_MIN})::int || ' min)' from \"JobSource\" s left join \"JobImportRun\" r on r.source = s.key and r.status in ('SUCCEEDED','PARTIAL') where s.enabled and s.scheduled and s.\"schedulePausedAt\" is null group by s.key, s.\"intervalMinutes\" having coalesce(max(r.\"finishedAt\"), (select max(a.\"createdAt\") from \"AdminAuditLog\" a where a.action = 'SOURCE_SCHEDULE_CHANGED' and a.\"targetId\" = s.key), 'epoch') < now() - make_interval(mins => (${ALLOWED_MIN})::int) union all select 'cooldown', key, coalesce(\"cooldownReason\", '') from \"JobSource\" where \"cooldownUntil\" > now() union all select 'unexpected', key, '' from \"JobSource\" where scheduled and key <> all(string_to_array('${SOURCE_ALLOWLIST}', ','))"
  if SOURCE_ROWS=$("$DOCKER" exec "$POSTGRES_CONTAINER" psql -U postgres -d aise -At -F '|' -c "$SOURCE_SQL" 2>/dev/null </dev/null); then
    SOURCE_PROBLEMS=0
    while IFS='|' read -r kind key detail; do
      [ -n "${kind:-}" ] || continue; SOURCE_PROBLEMS=$((SOURCE_PROBLEMS + 1))
      case "$kind" in
        stale) problem "vacancy source '$key' has had no finished run within its schedule (last: ${detail}) — jobs on the site may be going stale" ;;
        cooldown) problem "vacancy source '$key' is in cooldown after repeated failures or a block (${detail}) — see admin → Mənbələr; do not retry blindly" ;;
        unexpected) problem "vacancy source '$key' is scheduled but is not on the production allowlist (${SOURCE_ALLOWLIST}) — pause it in admin → Mənbələr unless it was approved" ;;
      esac
    done <<< "$SOURCE_ROWS"
    [ "$SOURCE_PROBLEMS" -eq 0 ] && ok "vacancy sources: scheduled sources fresh, none in cooldown, none outside the allowlist (${SOURCE_ALLOWLIST})"
  else
    problem "vacancy source check could not read the database (container ${POSTGRES_CONTAINER})"
  fi
fi

# ------------------------------------------------------------ employer billing --
# Read-only. Money without its entitlement is the one failure a customer notices at once: a PAID purchase that has no credit after 10 minutes, a refund that
# has been pending for a day, a credit paid for and never used for a week (the employer may be stuck), and a provider event received but not processed for
# 30 minutes. A normal first purchase appears only as an OK line. Trace one purchase end to end with scripts/employer-trace.sh.
if command -v "$DOCKER" >/dev/null 2>&1 && "$DOCKER" inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
  EMP_SQL="select 'paid_no_credit', p.id, coalesce(to_char(p.\"paidAt\", 'MM-DD HH24:MI'), '?') from \"EmployerPurchase\" p left join \"EmployerCredit\" c on c.\"purchaseId\" = p.id where p.status = 'PAID' and c.id is null and p.\"paidAt\" < now() - interval '10 minutes'
    union all select 'refund_stuck', p.id, coalesce(to_char(p.\"refundRequestedAt\", 'MM-DD HH24:MI'), '?') from \"EmployerPurchase\" p where p.status = 'REFUND_PENDING' and p.\"refundRequestedAt\" < now() - interval '24 hours'
    union all select 'paid_unused', c.id, to_char(c.\"createdAt\", 'MM-DD') from \"EmployerCredit\" c where c.status = 'AVAILABLE' and c.\"createdAt\" < now() - interval '7 days'
    union all select 'event_unprocessed', w.id, w.type from \"BillingWebhookEvent\" w where w.\"processedAt\" is null and w.\"receivedAt\" < now() - interval '30 minutes'"
  if EMP_ROWS=$("$DOCKER" exec "$POSTGRES_CONTAINER" psql -U postgres -d aise -At -F '|' -c "$EMP_SQL" 2>/dev/null </dev/null); then
    EMP_PROBLEMS=0
    while IFS='|' read -r kind key detail; do
      [ -n "${kind:-}" ] || continue; EMP_PROBLEMS=$((EMP_PROBLEMS + 1))
      case "$kind" in
        paid_no_credit) problem "employer purchase $key is PAID (${detail}) but has no listing credit after 10 minutes — customer paid and cannot publish: scripts/employer-trace.sh $key" ;;
        refund_stuck) problem "employer purchase $key has been REFUND_PENDING since ${detail} — check the provider's refund record: scripts/employer-trace.sh $key" ;;
        paid_unused) problem "employer credit $key was paid for on ${detail} and is still unused after 7 days — the employer may be stuck (review queue?)" ;;
        event_unprocessed) problem "billing event $key (${detail}) was received more than 30 minutes ago and is not processed — webhook handling may be failing" ;;
      esac
    done <<< "$EMP_ROWS"
    EMP_COUNTS=$("$DOCKER" exec "$POSTGRES_CONTAINER" psql -U postgres -d aise -At -F ' ' -c "select count(*) filter (where status = 'PAID'), count(*) filter (where status in ('REFUND_PENDING','REFUNDED')), (select count(*) from \"EmployerSubscription\" where status = 'active') from \"EmployerPurchase\"" 2>/dev/null </dev/null || true)
    [ "$EMP_PROBLEMS" -eq 0 ] && ok "employer billing: every paid purchase has its credit (paid / refunded / active Business: ${EMP_COUNTS:-n/a})"
  else
    problem "employer billing check could not read the database (container ${POSTGRES_CONTAINER})"
  fi
fi

kuma() { # up|down, short message
  [ -n "$UPTIME_KUMA_PUSH_URL" ] || return 0
  curl -fsS --max-time 10 -G "$UPTIME_KUMA_PUSH_URL" --data-urlencode "status=$1" --data-urlencode "msg=$2" >/dev/null \
    || printf 'ALERT uptime-kuma push failed\n'
}
email_alert() { # subject, body (labels only)
  [ -n "$ALERT_EMAIL_TO" ] || return 0
  local key; key="$(sed -n 's/^RESEND_API_KEY=//p' "$RESEND_ENV_FILE" 2>/dev/null | tail -n 1 | sed -e 's/^"//' -e 's/"$//')"
  [ -n "$key" ] || { printf 'ALERT email not sent: no RESEND_API_KEY readable in %s\n' "$RESEND_ENV_FILE"; return 1; }
  python3 - "$ALERT_EMAIL_FROM" "$ALERT_EMAIL_TO" "$1" "$2" > "$ALERT_STATE_FILE.payload" <<'PY' || return 1
import json, sys
print(json.dumps({"from": sys.argv[1], "to": [sys.argv[2]], "subject": sys.argv[3], "text": sys.argv[4]}))
PY
  # the key goes to curl on stdin as a config file, so it never appears in a process listing
  printf 'header = "Authorization: Bearer %s"\n' "$key" | curl -fsS --max-time 15 -K - -H 'Content-Type: application/json' --data @"$ALERT_STATE_FILE.payload" "$RESEND_API_URL" >/dev/null \
    || { rm -f "$ALERT_STATE_FILE.payload"; printf 'ALERT email delivery failed\n'; return 1; }
  rm -f "$ALERT_STATE_FILE.payload"
}
alert_state_hash() { printf '%s' "$1" | (shasum -a 256 2>/dev/null || sha256sum) | cut -c1-16; }
now_s="$(date -u +%s)"
if [ "${#PROBLEMS[@]}" -eq 0 ]; then
  kuma up "OK"
  if [ -n "$ALERT_EMAIL_TO" ] && [ -s "$ALERT_STATE_FILE" ]; then
    email_alert "AISE $(hostname): recovered" "All monitored checks are OK again." && rm -f "$ALERT_STATE_FILE"
  fi
else
  if [ -n "$ALERT_EMAIL_TO" ]; then
    h="$(alert_state_hash "$(printf '%s;' "${PROBLEMS[@]}")")"; last_h=""; last_t=0
    [ -s "$ALERT_STATE_FILE" ] && read -r last_h last_t < "$ALERT_STATE_FILE"
    if [ "$h" != "$last_h" ] || [ $((now_s - ${last_t:-0})) -ge $((ALERT_EMAIL_MIN_HOURS * 3600)) ]; then
      if email_alert "AISE $(hostname): ${#PROBLEMS[@]} problem(s)" "$(printf -- '- %s\n' "${PROBLEMS[@]}")"; then printf '%s %s\n' "$h" "$now_s" > "$ALERT_STATE_FILE"; fi
    fi
  fi
fi

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  kuma down "$(printf '%s; ' "${PROBLEMS[@]}" | cut -c1-200)"
  if [ -n "$ALERT_WEBHOOK_URL" ]; then
    TEXT="AISE $(hostname): $(printf '%s; ' "${PROBLEMS[@]}")"
    curl -fsS --max-time 10 -H 'Content-Type: application/json' \
      -d "{\"text\": $(printf '%s' "$TEXT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}" \
      "$ALERT_WEBHOOK_URL" >/dev/null || printf 'ALERT webhook delivery failed\n'
  fi
  exit 1
fi
exit 0
