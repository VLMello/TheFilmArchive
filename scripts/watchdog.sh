#!/bin/bash
# Self-healing check for TFA. Docker's bridge network has been observed to
# come up broken after an unclean host reboot/crash (inter-container
# connectivity silently fails even though every container is "Up"). No
# healthcheck or restart policy inside Docker can fix that from the inside —
# only recreating the compose network does. This runs on a host cron timer
# (not in a container) so it survives even if the whole stack is unreachable.
set -u
cd "$(dirname "$0")/.." || exit 1

LOG="$(pwd)/watchdog.log"
LOCK=/tmp/tfa-watchdog.lock

exec 9>"$LOCK"
flock -n 9 || exit 0

if curl -sf --max-time 10 http://localhost:3000/health >/dev/null 2>&1; then
  exit 0
fi

echo "$(date -Is) health check failed — recreating stack" >> "$LOG"
docker compose down >> "$LOG" 2>&1
docker compose up -d >> "$LOG" 2>&1
echo "$(date -Is) recreation attempt finished" >> "$LOG"
