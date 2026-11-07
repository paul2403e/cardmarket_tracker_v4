#!/usr/bin/env bash
# Täglicher Lauf (als Benutzer cmtracker, gestartet vom Zeitplan 04:41 / 11:11 / 17:11 Uhr):
# 1. Katalog & Price Guide – einmal pro Tag (bei Fehler beim nächsten Termin erneut)
# 2. Scrape – macht dort weiter, wo ein früherer Lauf aufgehört hat; ist der Tag fertig, endet er sofort
# Mails bei Auffälligkeiten verschickt der Scraper selbst; endet dieses Skript mit Fehler,
# schickt cmtracker-failure.service eine Mail (außer der Scraper hat schon gemeldet).
set -uo pipefail
APP=/opt/cmtracker
PY=$APP/venv/bin/python
STATE=/var/lib/cmtracker

set -a
# shellcheck disable=SC1091
. /etc/cmtracker/env
set +a
export FLARESOLVERR_URL=http://127.0.0.1:8191/v1

stamp=$(date +%Y%m%d-%H%M%S)
out=$STATE/out/$stamp
mkdir -p "$out"
echo "$out" > "$STATE/last_out"
export RUN_INFO="Server-Lauf $stamp – Protokoll: in der Oracle Cloud Shell per SSH anmelden und 'cm logs' eingeben."
cd "$APP/repo/scraper" || exit 1

exec 9>"$STATE/run.lock"
if ! flock -w 1200 9; then
  echo "Ein anderer Lauf (z. B. manueller Test) blockiert seit 20 Minuten – Abbruch."
  exit 1
fi

rc=0
today=$(date +%F)
if [ ! -e "$STATE/catalog-ok-$today" ]; then
  if "$PY" -m cmtracker catalog --out "$out" --publish-review; then
    touch "$STATE/catalog-ok-$today"
  else
    rc=1
  fi
fi

args=(--max-minutes "${MAX_MINUTES:-380}" --out "$out" --publish-review)
[ "$(date +%H)" -ge 17 ] && args+=(--final-attempt)
"$PY" -m cmtracker scrape "${args[@]}" || rc=1

find "$STATE/out" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
find "$STATE" -maxdepth 1 -name 'catalog-ok-*' -mtime +7 -delete
exit "$rc"
