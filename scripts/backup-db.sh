#!/bin/bash
# Daily Postgres backup. The named docker volume survives container
# restarts fine, but doesn't protect against volume corruption or an
# accidental `docker volume rm` — this gives an independent, restorable copy
# of TFA's list/movie tracking data (small: no media, just app state).
set -u
cd "$(dirname "$0")/.." || exit 1
set -a; source .env; set +a

BACKUP_DIR="$(pwd)/backups"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$BACKUP_DIR/tfa-$STAMP.sql.gz"

docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$FILE"

# Keep the last 14 daily backups.
ls -1t "$BACKUP_DIR"/tfa-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
