#!/usr/bin/env bash
#
# Lets the founder hand a credential to the deployment WITHOUT pasting it into chat, a document or a screenshot.
#
#   scripts/enter-secret.sh resend     # Resend sending-only key
#   scripts/enter-secret.sh dodo       # Dodo TEST-mode API key + test webhook signing secret
#   scripts/enter-secret.sh google     # Google OAuth client id + client secret
#   scripts/enter-secret.sh resend-webhook   # Resend webhook signing secret (whsec_...) for delivery evidence of e-mail applications
#
# It asks in plain language, reads the value with the screen echo OFF, checks only the SHAPE (never prints the value), and saves it in a private file
# (~/aise-preview/secrets-handoff/<name>.env, folder 700, file 600). Nothing is sent anywhere by this script; the engineer installs the file on the server
# and deletes it. Run it again to replace a wrong entry.
set -uo pipefail
NAME="${1:-}"
DIR="${AISE_SECRETS_DIR:-$HOME/aise-preview/secrets-handoff}"
case "$NAME" in
  resend) FIELDS=("RESEND_API_KEY|Resend API key (starts with re_, 'Sending access' only)|^re_[A-Za-z0-9_]{16,}$") ;;
  dodo)   FIELDS=("DODO_PAYMENTS_API_KEY|Dodo TEST-mode API key (from the Dodo dashboard switched to TEST mode)|^[A-Za-z0-9._-]{16,}$" "DODO_WEBHOOK_KEY|Dodo TEST-mode webhook signing secret (starts with whsec_)|^whsec_[A-Za-z0-9+/=_-]{16,}$") ;;
  google) FIELDS=("GOOGLE_CLIENT_ID|Google OAuth Client ID (ends with .apps.googleusercontent.com)|^[0-9]+-[A-Za-z0-9_-]+\\.apps\\.googleusercontent\\.com$" "GOOGLE_CLIENT_SECRET|Google OAuth Client secret (starts with GOCSPX-)|^GOCSPX-[A-Za-z0-9_-]{10,}$") ;;
  resend-webhook) FIELDS=("EMAIL_APPLY_WEBHOOK_SECRET|Resend webhook signing secret (starts with whsec_; shown on the webhook's page in the Resend dashboard)|^whsec_[A-Za-z0-9+/=_-]{16,}$") ;;
  *) echo "Usage: $0 resend | dodo | google | resend-webhook" >&2; exit 2 ;;
esac
umask 077; mkdir -p "$DIR"; chmod 700 "$DIR"
OUT="$DIR/$NAME.env"; TMP="$(mktemp "$DIR/.entry.XXXXXX")"; trap 'rm -f "$TMP"' EXIT
echo
echo "Nothing you type below is shown on screen, and nothing is sent anywhere."
for spec in "${FIELDS[@]}"; do
  IFS='|' read -r var label pattern <<<"$spec"
  while :; do
    echo; echo "Paste the $label, then press Enter."
    if [ "${AISE_ENTER_SECRET_STDIN:-}" = 1 ]; then IFS= read -r value; else IFS= read -rs -p "> " value; echo; fi
    value="${value//[$'\r\n\t ']/}"
    if [[ "$value" =~ $pattern ]]; then printf '%s=%s\n' "$var" "$value" >> "$TMP"; echo "OK: received ${#value} characters (not shown)."; break; fi
    echo "That does not look like a $var (nothing was saved). Try again, or press Ctrl+C to stop."
    [ "${AISE_ENTER_SECRET_STDIN:-}" = 1 ] && exit 1
  done
done
mv "$TMP" "$OUT"; chmod 600 "$OUT"; trap - EXIT
echo; echo "Saved privately. You can close this window. Tell the engineer: \"$NAME entered\"."
