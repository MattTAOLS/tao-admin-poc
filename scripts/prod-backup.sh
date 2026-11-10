#!/bin/sh
# Back up the production stack: the database (pg_dump, custom format) and the uploaded files (the filestore volume).
# Run from anywhere on the server; writes two files into the folder given (default: backups/ beside the compose file):
#   tao_admin-YYYYMMDD-HHMMSS.dump     database
#   filestore-YYYYMMDD-HHMMSS.tgz      uploaded SetRep PDFs and page images
# The stack keeps running. Each file is written under a temporary name and renamed only when it is complete, so a
# failed run never leaves a half-written file that looks like a backup. Backups older than KEEP_DAYS (default 14) are
# removed from that folder after a successful run. Schedule it daily (cron) and copy the folder off the server.
# Also keep a copy of .env somewhere safe: it holds NEWS_SECRET_KEY, without which stored news-source keys are lost.
#   scripts/prod-backup.sh [folder]          KEEP_DAYS=30 scripts/prod-backup.sh
set -eu
export MSYS_NO_PATHCONV=1                      # Git Bash on Windows must not rewrite /data and similar paths
cd "$(dirname "$0")/.."
DIR=${1:-backups}
KEEP_DAYS=${KEEP_DAYS:-14}
mkdir -p "$DIR"
TS=$(date +%Y%m%d-%H%M%S)
C="docker compose -f docker-compose.prod.yml"
DB="$DIR/tao_admin-$TS.dump"
FS="$DIR/filestore-$TS.tgz"
trap 'rm -f "$DB.part" "$FS.part"' EXIT

# The dump first, then the files: an upload's file is written before its database row, so the files always cover the dump.
$C exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$DB.part"
[ -s "$DB.part" ] || { echo "The database dump is empty; no backup written."; exit 1; }
$C exec -T api tar czf - -C /data . > "$FS.part"
[ -s "$FS.part" ] || { echo "The filestore archive is empty; no backup written."; exit 1; }
mv "$DB.part" "$DB"
mv "$FS.part" "$FS"

ls -l "$DB" "$FS"
# Prune: only this script's own files, only in this folder, only once today's backup is complete.
find "$DIR" -maxdepth 1 -type f \( -name 'tao_admin-*.dump' -o -name 'filestore-*.tgz' \) -mtime +"$KEEP_DAYS" -exec rm -f {} +
echo "Backup written to $DIR (backups older than $KEEP_DAYS days removed)"
