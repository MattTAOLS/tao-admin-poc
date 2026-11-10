#!/bin/sh
# Restore the production stack from a backup: REPLACES the database and the uploaded files.
#   scripts/prod-restore.sh <database file> <filestore .tgz>
# The database file is either a custom-format dump (.dump, from prod-backup.sh or export-dev-data.sh) or a plain SQL
# dump (.sql).
#
# Order, so a bad backup never costs you the data you have:
#   1. Both files are checked while the app is still running (the dump is listed, the archive is read end to end).
#   2. The app containers stop. The dump is loaded into a scratch database, and the files are unpacked into a scratch
#      folder. The live database and the live files are untouched until both have loaded.
#   3. Only then are they swapped in, the job queues are cleared, and the app starts again.
# If anything fails before the swap, the scratch copies are removed and the app is started again on the old data.
# On start-up the API applies any migrations the dump is missing.
set -eu
export MSYS_NO_PATHCONV=1                      # Git Bash on Windows must not rewrite /data and similar paths
[ $# -eq 2 ] || { echo "usage: $0 <database .dump|.sql> <filestore .tgz>"; exit 2; }
DB_FILE=$1
FS_FILE=$2
[ -s "$DB_FILE" ] || { echo "not found or empty: $DB_FILE"; exit 2; }
[ -s "$FS_FILE" ] || { echo "not found or empty: $FS_FILE"; exit 2; }
case "$FS_FILE" in *.tgz|*.tar.gz) ;; *) echo "the second file must be the filestore archive (.tgz): $FS_FILE"; exit 2 ;; esac
case "$DB_FILE" in *.dump|*.sql) ;; *) echo "the first file must be the database dump (.dump or .sql): $DB_FILE"; exit 2 ;; esac
# Absolute paths before the cd below.
DB_FILE=$(cd "$(dirname "$DB_FILE")" && pwd)/$(basename "$DB_FILE")
FS_FILE=$(cd "$(dirname "$FS_FILE")" && pwd)/$(basename "$FS_FILE")
cd "$(dirname "$0")/.."
C="docker compose -f docker-compose.prod.yml"

# --- 1. check both files before touching anything --------------------------------------------------------------------
# Commands that take no file get </dev/null, so none of them can swallow the answer typed at the prompt below.
$C up -d postgres >/dev/null </dev/null
tries=0
until $C exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d postgres' >/dev/null 2>&1 </dev/null; do
  tries=$((tries + 1)); [ "$tries" -le 60 ] || { echo "Postgres did not come up; nothing changed."; exit 1; }
  sleep 2
done
case "$DB_FILE" in
  *.sql) head -c 4096 "$DB_FILE" | grep -q "PostgreSQL database dump" || { echo "$DB_FILE does not look like a PostgreSQL dump; nothing changed."; exit 1; } ;;
  *)     $C exec -T postgres pg_restore -l < "$DB_FILE" >/dev/null || { echo "$DB_FILE is not a readable dump (truncated or the wrong file); nothing changed."; exit 1; } ;;
esac
# gzip -t reads the whole file and fails on a truncated one (a tar listing alone can stop early without an error).
$C exec -T postgres gzip -t < "$FS_FILE" || { echo "$FS_FILE is not a complete archive (truncated or the wrong file); nothing changed."; exit 1; }
$C exec -T postgres sh -c 'tar tzf - >/dev/null' < "$FS_FILE" || { echo "$FS_FILE is not a readable archive; nothing changed."; exit 1; }
echo "Both backup files are readable."

printf 'This replaces the database and all uploaded files with the backup. Type RESTORE to go on: '
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Stopped; nothing changed."; exit 1; }

# --- 2. load into scratch copies -----------------------------------------------------------------------------------------
swapped=no
cleanup() {
  code=$?
  if [ "$code" -ne 0 ] && [ "$swapped" = no ]; then
    echo "The restore failed before the swap. Your existing database and files are unchanged. Starting the app again..."
    $C exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "${POSTGRES_DB}_restore"' >/dev/null 2>&1 </dev/null || true
    $C run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /data/.restore' >/dev/null 2>&1 </dev/null || true
    $C up -d </dev/null || true
  elif [ "$code" -ne 0 ]; then
    echo "The backup was swapped in, but a later step failed. Check: $C ps ; $C logs --tail 50 api"
  fi
}
trap cleanup EXIT

$C stop web news worker api </dev/null
$C exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "${POSTGRES_DB}_restore" && createdb -U "$POSTGRES_USER" "${POSTGRES_DB}_restore"' </dev/null
case "$DB_FILE" in
  *.sql) $C exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore"' < "$DB_FILE" >/dev/null ;;
  *)     $C exec -T postgres sh -c 'pg_restore --no-owner --no-acl --exit-on-error -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore"' < "$DB_FILE" ;;
esac
# The api container is stopped, so a one-off container with the same volume unpacks the files beside the live ones.
$C run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /data/.restore && mkdir /data/.restore && tar xzf - -C /data/.restore' < "$FS_FILE"

# --- 3. swap, clear the queues, start ---------------------------------------------------------------------------------
$C exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "alter database \"${POSTGRES_DB}_restore\" rename to \"${POSTGRES_DB}\""' </dev/null
swapped=yes
$C run --rm --no-deps -T --entrypoint sh api -c 'cd /data && for f in * .[!.]*; do [ -e "$f" ] || continue; [ "$f" = .restore ] && continue; rm -rf "$f"; done; for f in .restore/* .restore/.[!.]*; do [ -e "$f" ] || continue; mv "$f" /data/; done; rmdir .restore' </dev/null
# Jobs queued before the restore belong to the data that was just replaced.
$C up -d redis >/dev/null </dev/null
$C exec -T redis redis-cli del extract:jobs news >/dev/null </dev/null || true

$C up -d </dev/null
echo "Restored. Waiting for the API..."
tries=0
until $C exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4)" >/dev/null 2>&1 </dev/null; do
  tries=$((tries + 1))
  [ "$tries" -le 60 ] || { echo "The API did not answer after 3 minutes. See: $C logs --tail 80 api"; exit 1; }
  sleep 3
done
echo "Done."
