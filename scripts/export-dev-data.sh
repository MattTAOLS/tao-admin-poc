#!/bin/sh
# Export everything from the development stack (the laptop, docker-compose.yml) to move it onto the production server:
# every upload, review, publication, setting, user, note and audit entry, plus the uploaded files.
#   scripts/export-dev-data.sh [folder] [compose project]      (defaults: data/export, tao-admin-poc)
# Then copy the two files to the server and run scripts/prod-restore.sh there. The development stack keeps running
# and is not changed. On Windows, run it from Git Bash in the repo folder.
set -eu
cd "$(dirname "$0")/.."
DIR=${1:-data/export}
PROJECT=${2:-tao-admin-poc}
mkdir -p "$DIR"
TS=$(date +%Y%m%d-%H%M)
C="docker compose -p $PROJECT -f docker-compose.yml"

$C exec -T postgres pg_dump -U tao -d tao_admin --format=custom > "$DIR/tao_admin-$TS.dump"
$C exec -T api tar czf - -C /data . > "$DIR/filestore-$TS.tgz"

ls -l "$DIR/tao_admin-$TS.dump" "$DIR/filestore-$TS.tgz"
echo "Copy both files to the server, then run there: scripts/prod-restore.sh tao_admin-$TS.dump filestore-$TS.tgz"
