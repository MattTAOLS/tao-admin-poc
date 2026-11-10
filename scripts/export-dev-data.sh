#!/bin/sh
# Export everything from the development stack (the laptop, docker-compose.yml) to move it onto the production server:
# every upload, review, publication, setting, user, note and audit entry, plus the uploaded files.
#   scripts/export-dev-data.sh [folder] [compose project]      (defaults: data/export, tao-admin-poc)
# Then copy the two files to the server and run scripts/prod-restore.sh there. The development stack keeps running
# and is not changed. On Windows, run it from Git Bash in the repo folder.
#
# Stored news-source keys are encrypted with NEWS_SECRET_KEY from this machine's .env. To keep them working on the
# server, put the SAME NEWS_SECRET_KEY in the server's .env before restoring (otherwise enter the keys again there).
set -eu
export MSYS_NO_PATHCONV=1                      # Git Bash must not rewrite /data into C:/Program Files/Git/data
cd "$(dirname "$0")/.."
DIR=${1:-data/export}
PROJECT=${2:-tao-admin-poc}
mkdir -p "$DIR"
TS=$(date +%Y%m%d-%H%M%S)
C="docker compose -p $PROJECT -f docker-compose.yml"
DB="$DIR/tao_admin-$TS.dump"
FS="$DIR/filestore-$TS.tgz"
trap 'rm -f "$DB.part" "$FS.part"' EXIT

$C exec -T postgres pg_dump -U tao -d tao_admin --format=custom > "$DB.part"
[ -s "$DB.part" ] || { echo "The database dump is empty; nothing exported."; exit 1; }
$C exec -T api tar czf - -C /data . > "$FS.part"
[ -s "$FS.part" ] || { echo "The filestore archive is empty; nothing exported."; exit 1; }
mv "$DB.part" "$DB"
mv "$FS.part" "$FS"

ls -l "$DB" "$FS"
echo "Copy both files to the server, then run there: scripts/prod-restore.sh tao_admin-$TS.dump filestore-$TS.tgz"
echo "To keep stored news-source keys working, copy NEWS_SECRET_KEY from this machine's .env into the server's .env first."
