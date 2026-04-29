#!/usr/bin/env bash
# infra/scripts/restore.sh — restore Postgres from a backup file
#
# Usage:
#   infra/scripts/restore.sh <backup-file>
#   infra/scripts/restore.sh backups/nightly/db-20260501T030000Z.sql.gz

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
cd "$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ $# -lt 1 ]]; then
  err "Usage: infra/scripts/restore.sh <backup-file>"
  echo
  echo "Recent backups:"
  ls -lh backups/nightly/db-*.sql.gz* 2>/dev/null | tail -10 | sed 's/^/  /' || warn "No backups found"
  exit 1
fi

BACKUP_FILE="$1"
[[ -f "$BACKUP_FILE" ]] || { err "File not found: $BACKUP_FILE"; exit 1; }

[[ -f .env ]] || { err "Missing .env"; exit 1; }
set -a; source ./.env; set +a
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=myclash}"

COMPOSE=(docker compose --env-file .env -f infra/docker-compose.prod.yml)

hdr "Restore plan"
info "Backup file:    $BACKUP_FILE"
info "Target DB:      $POSTGRES_DB on db container"
warn "This will DROP the existing $POSTGRES_DB database and recreate it."

confirm "Proceed?" || { warn "Aborted."; exit 0; }

# Stop app services so they don't write during restore
hdr "Stopping app services"
"${COMPOSE[@]}" stop api web-public web-scoring web-admin worker
ok "App services stopped"

# Decrypt if needed
RESTORE_FILE="$BACKUP_FILE"
TEMP_DECRYPTED=""
if [[ "$BACKUP_FILE" == *.gpg ]]; then
  hdr "Decrypting"
  TEMP_DECRYPTED="${BACKUP_FILE%.gpg}.tmp"
  gpg --decrypt --output "$TEMP_DECRYPTED" "$BACKUP_FILE"
  RESTORE_FILE="$TEMP_DECRYPTED"
  trap 'rm -f "$TEMP_DECRYPTED"' EXIT
  ok "Decrypted"
fi

# Drop and recreate
hdr "Dropping and recreating database"
"${COMPOSE[@]}" exec -T db psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};"
"${COMPOSE[@]}" exec -T db psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE ${POSTGRES_DB};"
ok "Database recreated"

# Restore
hdr "Restoring"
gunzip -c "$RESTORE_FILE" | "${COMPOSE[@]}" exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
ok "Restore complete"

# Restart app services
hdr "Restarting app services"
"${COMPOSE[@]}" up -d
ok "App services restarted"

echo
ok "Restored from $BACKUP_FILE"
warn "Note: after restore, run 'infra/scripts/status.sh' to verify health."
