#!/bin/sh
# Restore the production stack from a backup: REPLACES the database and the uploaded files.
#   scripts/prod-restore.sh <database file> <filestore .tgz>
# The database file is either a custom-format dump (.dump, from prod-backup.sh or export-dev-data.sh) or a plain SQL
# dump (.sql). The script stops the app containers, drops and recreates the database, loads the dump, replaces the
# files, and starts everything again. On start-up the API applies any migrations the dump is missing.
set -eu
[ $# -eq 2 ] || { echo "usage: $0 <database .dump|.sql> <filestore .tgz>"; exit 2; }
DB_FILE=$1
FS_FILE=$2
[ -f "$DB_FILE" ] || { echo "not found: $DB_FILE"; exit 2; }
[ -f "$FS_FILE" ] || { echo "not found: $FS_FILE"; exit 2; }
# Absolute paths before the cd below.
DB_FILE=$(cd "$(dirname "$DB_FILE")" && pwd)/$(basename "$DB_FILE")
FS_FILE=$(cd "$(dirname "$FS_FILE")" && pwd)/$(basename "$FS_FILE")
cd "$(dirname "$0")/.."
C="docker compose -f docker-compose.prod.yml"

printf 'This replaces the database and all uploaded files with the backup. Type RESTORE to go on: '
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Stopped; nothing changed."; exit 1; }

$C stop web news worker api
$C up -d postgres redis
until $C exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d postgres' >/dev/null 2>&1; do sleep 2; done

$C exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
case "$DB_FILE" in
  *.sql) $C exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$DB_FILE" ;;
  *)     $C exec -T postgres sh -c 'pg_restore --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$DB_FILE" ;;
esac

# Replace the uploaded files. The api container is stopped, so use a one-off container with the same volume.
$C run --rm --no-deps -T --entrypoint sh api -c 'find /data -mindepth 1 -delete && tar xzf - -C /data' < "$FS_FILE"

$C up -d
echo "Restored. Waiting for the API..."
until $C exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4)" >/dev/null 2>&1; do sleep 3; done
echo "Done."
