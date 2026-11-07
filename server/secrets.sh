#!/usr/bin/env bash
# Zugangsdaten abfragen und nur für den Scraper lesbar speichern (/etc/cmtracker/env).
# Eingaben bei Passwörtern/Schlüsseln bleiben unsichtbar. Leere Eingabe = bisherigen Wert behalten.
set -euo pipefail
ENVFILE=/etc/cmtracker/env
USER_NAME=cmtracker
[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten."; exit 1; }

declare -A OLD=()
if [ -s "$ENVFILE" ]; then
  while IFS= read -r line; do
    key=${line%%=*}
    # shellcheck disable=SC1090
    OLD[$key]=$(set -a; . "$ENVFILE"; printf '%s' "${!key:-}")
  done < <(grep -E '^[A-Z0-9_]+=' "$ENVFILE")
fi

declare -A NEW=()
ask() {  # ask NAME "Beschreibung" secret|plain [Standardwert]
  local name=$1 text=$2 mode=$3 def=${4:-} val="" hint=""
  if [ -n "${OLD[$name]:-}" ]; then hint=" [Enter = behalten]"; elif [ -n "$def" ]; then hint=" [Enter = $def]"; fi
  if [ "$mode" = secret ]; then
    read -r -s -p "$text$hint: " val < /dev/tty; echo
  else
    read -r -p "$text$hint: " val < /dev/tty
  fi
  val=${val#"${val%%[![:space:]]*}"}; val=${val%"${val##*[![:space:]]}"}
  [ -z "$val" ] && val=${OLD[$name]:-$def}
  NEW[$name]=$val
}

echo "Zugangsdaten eingeben (werden nur auf diesem Server gespeichert):"
ask CM_USERNAME          "Cardmarket Benutzername" plain
ask CM_PASSWORD          "Cardmarket Passwort" secret
ask R2_ACCOUNT_ID        "Cloudflare R2 Account ID (32 Zeichen)" plain
ask R2_ACCESS_KEY_ID     "R2 Access Key ID (32 Zeichen)" secret
ask R2_SECRET_ACCESS_KEY "R2 Secret Access Key (64 Zeichen)" secret
ask R2_BUCKET            "R2 Bucket-Name" plain cm-market-data
ask SMTP_USER            "Gmail-Adresse für Warn-Mails" plain
ask SMTP_PASS            "Gmail App-Passwort (16 Zeichen)" secret
ask ALERT_EMAIL_TO       "Empfänger der Warn-Mails" plain "${NEW[SMTP_USER]}"
ask HC_PING_URL          "healthchecks.io Ping-URL" plain
NEW[SMTP_PASS]=${NEW[SMTP_PASS]// /}   # Google zeigt das App-Passwort mit Leerzeichen an

umask 077
tmp=$(mktemp "$ENVFILE.XXXX")
for name in CM_USERNAME CM_PASSWORD R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET \
            SMTP_USER SMTP_PASS ALERT_EMAIL_TO HC_PING_URL; do
  v=${NEW[$name]//\'/\'\\\'\'}
  printf "%s='%s'\n" "$name" "$v" >> "$tmp"
done
chown "$USER_NAME:$USER_NAME" "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$ENVFILE"
echo "Gespeichert in $ENVFILE (nur für den Scraper lesbar)."
