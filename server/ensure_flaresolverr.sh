#!/usr/bin/env bash
# FlareSolverr-Container sicherstellen (als root). Sonntags bzw. mit --pull wird das Image aktualisiert.
set -uo pipefail
IMAGE=ghcr.io/flaresolverr/flaresolverr:latest
NAME=flaresolverr

if [ "${1:-}" = "--pull" ] || [ "$(date +%u)" = 7 ]; then
  if docker pull -q "$IMAGE" >/dev/null; then
    running=$(docker inspect -f '{{.Image}}' "$NAME" 2>/dev/null || true)
    latest=$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || true)
    if [ -n "$running" ] && [ "$running" != "$latest" ]; then
      echo "[flaresolverr] neue Version – Container wird ersetzt"
      docker rm -f "$NAME" >/dev/null
    fi
  else
    echo "[flaresolverr] WARNUNG: Image-Update fehlgeschlagen – nutze vorhandenes"
  fi
fi

if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --restart unless-stopped -p 127.0.0.1:8191:8191 \
    -e LOG_LEVEL=info -e LOG_HTML=false -e CAPTCHA_SOLVER=none -e TZ=Europe/Berlin \
    "$IMAGE" >/dev/null || { echo "[flaresolverr] Start fehlgeschlagen"; exit 1; }
fi

for _ in $(seq 1 60); do
  if curl -fs http://127.0.0.1:8191/ >/dev/null; then
    echo "[flaresolverr] bereit"
    exit 0
  fi
  sleep 2
done
echo "[flaresolverr] startet nicht"
docker logs --tail 30 "$NAME" 2>&1
exit 1
