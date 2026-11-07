#!/usr/bin/env bash
# Mail, wenn der tägliche Lauf mit Fehler endet – nur falls der Scraper nicht schon selbst gemeldet hat.
set -uo pipefail
set -a
# shellcheck disable=SC1091
. /etc/cmtracker/env
set +a
out=$(cat /var/lib/cmtracker/last_out 2>/dev/null || echo /nonexistent)
log=$(journalctl -u cmtracker-daily.service -n 40 --no-pager -o cat 2>/dev/null)
/usr/bin/python3 /opt/cmtracker/repo/scraper/cmtracker/alerts.py --skip-if-sent "$out" \
  --subject "Server-Lauf fehlgeschlagen" \
  --body "Der tägliche Lauf auf dem Server ist mit einem Fehler beendet worden.

Letzte Zeilen des Protokolls:
$log

Ganzes Protokoll: in der Oracle Cloud Shell per SSH anmelden und 'cm logs' eingeben."
