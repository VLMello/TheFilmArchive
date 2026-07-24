#!/bin/bash
# Keeps the LAN-local thefilmarchive.com DNS record (served by the dnsmasq
# container) pointed at this host's actual IP. The box gets its address from
# DHCP with no reservation, so the IP can change on lease renewal or after
# one of this host's occasional unclean reboots — this re-detects it and
# rewrites dnsmasq's record whenever it differs from what's on file.
set -u
cd "$(dirname "$0")/.." || exit 1

LOG="$(pwd)/dns-sync.log"
LOCK=/tmp/tfa-dns-sync.lock

exec 9>"$LOCK"
flock -n 9 || exit 0

IFACE=$(ip route show default | awk '{print $5; exit}')
[ -z "$IFACE" ] && exit 0
IP=$(ip -4 -o addr show "$IFACE" | awk '{print $4}' | cut -d/ -f1 | head -n1)
[ -z "$IP" ] && exit 0

RECORD_FILE="$(pwd)/dnsmasq/records/thefilmarchive.conf"
NEW_LINE="address=/thefilmarchive.com/$IP"
mkdir -p "$(dirname "$RECORD_FILE")"

if [ "$(cat "$RECORD_FILE" 2>/dev/null)" = "$NEW_LINE" ]; then
  exit 0
fi

echo "$NEW_LINE" > "$RECORD_FILE"
echo "$(date -Is) thefilmarchive.com now points to $IP" >> "$LOG"
docker compose kill -s HUP dnsmasq >> "$LOG" 2>&1
