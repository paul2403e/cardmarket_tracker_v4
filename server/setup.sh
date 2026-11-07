#!/usr/bin/env bash
# Einrichtung des Scraper-Servers (Ubuntu 24.04, Oracle Cloud, ARM oder x86) – einmalig.
#
#   curl -fsSL https://raw.githubusercontent.com/paul2403e/cardmarket_tracker_v4/main/server/setup.sh -o setup.sh
#   sudo bash setup.sh
#
# Darf jederzeit erneut ausgeführt werden (repariert/aktualisiert, Zugangsdaten bleiben erhalten).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/paul2403e/cardmarket_tracker_v4.git}"
BRANCH="${BRANCH:-main}"
APP=/opt/cmtracker
REPO=$APP/repo
VENV=$APP/venv
STATE=/var/lib/cmtracker
ENVFILE=/etc/cmtracker/env
USER_NAME=cmtracker

[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten:  sudo bash setup.sh"; exit 1; }
step() { echo; echo "==> $*"; }

step "Zeitzone Europe/Berlin"
timedatectl set-timezone Europe/Berlin

step "Pakete installieren (dauert ein paar Minuten)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git python3 python3-venv python3-pip docker.io unattended-upgrades curl ca-certificates
systemctl enable --now docker

step "Automatische Sicherheits-Updates (Neustart falls nötig um 02:30 Uhr)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
cat > /etc/apt/apt.conf.d/52cmtracker-upgrades <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "02:30";
CONF

step "Benutzer '$USER_NAME' und Ordner"
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP" --shell /usr/sbin/nologin "$USER_NAME"
fi
install -d -o "$USER_NAME" -g "$USER_NAME" -m 755 "$APP"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 750 "$STATE" "$STATE/out"
install -d -o root -g "$USER_NAME" -m 750 /etc/cmtracker

step "Code von GitHub holen"
if [ -d "$REPO/.git" ]; then
  runuser -u "$USER_NAME" -- git -C "$REPO" fetch -q origin "$BRANCH"
  runuser -u "$USER_NAME" -- git -C "$REPO" reset -q --hard "origin/$BRANCH"
else
  runuser -u "$USER_NAME" -- git clone -q --branch "$BRANCH" "$REPO_URL" "$REPO"
fi
runuser -u "$USER_NAME" -- git -C "$REPO" log --oneline -1

step "Python-Umgebung"
[ -x "$VENV/bin/python" ] || runuser -u "$USER_NAME" -- python3 -m venv "$VENV"
rm -f "$STATE/requirements.sha"   # erzwingt die Installation in update.sh

step "Pakete, Zeitpläne und Befehl 'cm' einrichten"
bash "$REPO/server/update.sh"

step "FlareSolverr starten"
bash "$REPO/server/ensure_flaresolverr.sh" --pull

if [ -s "$ENVFILE" ]; then
  read -r -p "Zugangsdaten sind schon hinterlegt. Neu eingeben? (j/N) " again < /dev/tty
  [[ "$again" =~ ^[jJyY]$ ]] && bash "$REPO/server/secrets.sh"
else
  bash "$REPO/server/secrets.sh"
fi

step "Selbsttest"
cm selftest || true

step "Zeitpläne aktiv"
systemctl enable --now cmtracker-daily.timer >/dev/null
systemctl list-timers cmtracker-daily.timer --no-pager

cat <<'DONE'

Fertig. Nächster Schritt – Testlauf mit 20 Produkten:

    cm test

Weitere Befehle:  cm help
DONE
