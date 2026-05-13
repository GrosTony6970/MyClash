#!/usr/bin/env bash
# infra/scripts/rollback.sh
#
# Reverts the last deploy. Reads .last-deploy.json to find the previous
# commit and pre-deploy backup, then:
#   1. Stops containers
#   2. Restores Postgres from the pre-deploy backup
#   3. git reset --hard <previous commit>
#   4. Rebuilds
#   5. Restarts
#   6. Smoke tests
#
# Confirms before any destructive action.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"

ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

LOCK_FILE="$ROOT_DIR/.deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  err "Another deploy/rollback is already running. Lock: $LOCK_FILE"
  exit 1
fi
trap 'rm -f "$LOCK_FILE"' EXIT

# ── Read last deploy metadata ────────────────────────────────────
hdr "Reading last deploy metadata"

if [[ ! -f .last-deploy.json ]]; then
  err "No .last-deploy.json found — cannot determine what to roll back to"
  exit 1
fi

require_cmd jq

PREV_COMMIT=$(jq -r '.previousCommit' .last-deploy.json)
DEPLOYED_COMMIT=$(jq -r '.deployedCommit' .last-deploy.json)
BACKUP_FILE=$(jq -r '.backupFile' .last-deploy.json)
DEPLOYED_AT=$(jq -r '.deployedAt' .last-deploy.json)

info "Currently deployed: ${DEPLOYED_COMMIT:0:8} (deployed $DEPLOYED_AT)"
info "Will roll back to:  ${PREV_COMMIT:0:8}"
info "Will restore DB from: $BACKUP_FILE"

if [[ "$BACKUP_FILE" == "none" || ! -f "$BACKUP_FILE" ]]; then
  warn "No pre-deploy backup found. DB will not be restored."
  warn "If migrations ran, you may need to manually intervene."
fi

echo
confirm "Proceed with rollback? This is destructive." || { warn "Aborted."; exit 0; }

# ── Load env ─────────────────────────────────────────────────────
set -a; source ./.env; set +a
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=myclash}"

COMPOSE_FILES=(-f infra/docker-compose.prod.yml)

# ── Stop services (keep db running for restore) ──────────────────
hdr "Stopping app services"

docker compose --env-file .env "${COMPOSE_FILES[@]}" stop api web-public web-scoring web-admin worker
ok "App services stopped"

# ── Restore database ─────────────────────────────────────────────
if [[ "$BACKUP_FILE" != "none" && -f "$BACKUP_FILE" ]]; then
  hdr "Restoring database from $BACKUP_FILE"

  # Drop and recreate the schema cleanly to ensure a deterministic restore
  docker compose --env-file .env "${COMPOSE_FILES[@]}" exec -T db \
    psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};"
  docker compose --env-file .env "${COMPOSE_FILES[@]}" exec -T db \
    psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE ${POSTGRES_DB};"

  gunzip -c "$BACKUP_FILE" | \
    docker compose --env-file .env "${COMPOSE_FILES[@]}" exec -T db \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  ok "Database restored"
fi

# ── Reset git ────────────────────────────────────────────────────
hdr "Resetting code to $PREV_COMMIT"

git reset --hard "$PREV_COMMIT"
ok "Code reset"

# ── Rebuild ──────────────────────────────────────────────────────
hdr "Rebuilding images"

docker compose --env-file .env "${COMPOSE_FILES[@]}" build
ok "Images built"

# ── Restart ──────────────────────────────────────────────────────
hdr "Starting stack"

docker compose --env-file .env "${COMPOSE_FILES[@]}" up -d
ok "Stack started"

# ── Smoke test ───────────────────────────────────────────────────
hdr "Smoke test"

sleep 5
if curl -fsSL "https://api.${DOMAIN}/health" >/dev/null 2>&1; then
  ok "API /health reachable"
else
  warn "API /health not reachable yet (containers may still be starting)"
fi

# ── Record rollback metadata ─────────────────────────────────────
mv .last-deploy.json ".last-deploy.json.rolled-back-$(date -u +"%Y%m%dT%H%M%SZ")"

cat > .last-deploy.json <<EOF
{
  "previousCommit": "$DEPLOYED_COMMIT",
  "deployedCommit": "$PREV_COMMIT",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "deployedBy": "${SUDO_USER:-${USER:-unknown}}",
  "backupFile": "none",
  "isRollback": true
}
EOF

hdr "Rollback complete"
echo
ok "Rolled back to ${PREV_COMMIT:0:8}"
echo "  Status: infra/scripts/status.sh"
