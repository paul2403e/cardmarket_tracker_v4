#!/usr/bin/env bash
# Vor jedem Lauf (als root): neuesten Code von GitHub holen, Pakete und Zeitpläne aktualisieren.
# Scheitert GitHub, läuft der Scraper mit dem vorhandenen Code weiter.
set -uo pipefail
APP=/opt/cmtracker
REPO=$APP/repo
VENV=$APP/venv
STATE=/var/lib/cmtracker
USER_NAME=cmtracker
BRANCH="${BRANCH:-main}"
as_app() { runuser -u "$USER_NAME" -- "$@"; }

rm -f "$STATE/last_out"   # Fehler-Mail soll sich nicht auf einen früheren Lauf beziehen

if as_app git -C "$REPO" fetch -q origin "$BRANCH" && as_app git -C "$REPO" reset -q --hard "origin/$BRANCH"; then
  echo "[update] Code: $(as_app git -C "$REPO" log --oneline -1)"
else
  echo "[update] WARNUNG: GitHub nicht erreichbar – Lauf mit vorhandenem Code"
fi

req="$REPO/scraper/requirements.txt"
sha=$(sha256sum "$req" | cut -d' ' -f1)
if [ "$sha" != "$(cat "$STATE/requirements.sha" 2>/dev/null)" ]; then
  echo "[update] Python-Pakete installieren"
  if as_app "$VENV/bin/pip" install -q --disable-pip-version-check -r "$req"; then
    echo "$sha" > "$STATE/requirements.sha"
  else
    echo "[update] WARNUNG: Paket-Installation fehlgeschlagen"
  fi
fi

changed=0
for unit in "$REPO"/server/systemd/*; do
  target=/etc/systemd/system/$(basename "$unit")
  if ! cmp -s "$unit" "$target"; then
    install -m 644 "$unit" "$target"
    changed=1
  fi
done
if [ "$changed" = 1 ]; then
  systemctl daemon-reload
  echo "[update] Zeitpläne aktualisiert"
fi
systemctl enable cmtracker-daily.timer >/dev/null 2>&1 || true
install -m 755 "$REPO/server/cm" /usr/local/bin/cm
exit 0
