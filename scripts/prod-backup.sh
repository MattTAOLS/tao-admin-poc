#!/bin/sh
# Back up the production stack: the database (pg_dump, custom format) and the uploaded files (the filestore volume).
# Run from anywhere on the server; writes two files into the folder given (default: backups/ beside the compose file):
#   tao_admin-YYYYMMDD-HHMM.dump     database
#   filestore-YYYYMMDD-HHMM.tgz      uploaded SetRep PDFs and page images
# The stack keeps running. Schedule it daily (cron) and copy the folder off the server.
#   scripts/prod-backup.sh [folder]
set -eu
cd "$(dirname "$0")/.."
DIR=${1:-backups}
mkdir -p "$DIR"
TS=$(date +%Y%m%d-%H%M)
C="docker compose -f docker-compose.prod.yml"

$C exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$DIR/tao_admin-$TS.dump"
$C exec -T api tar czf - -C /data . > "$DIR/filestore-$TS.tgz"

ls -l "$DIR/tao_admin-$TS.dump" "$DIR/filestore-$TS.tgz"
echo "Backup written to $DIR"
