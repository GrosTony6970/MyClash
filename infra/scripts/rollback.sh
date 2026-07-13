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

case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: infra/scripts/rollback.sh

Revert the last deploy. Reads .last-deploy.json to find the previous commit and
pre-deploy backup, then: stop app services, restore Postgres from that backup,
git reset --hard to the previous commit, rebuild, restart, and smoke-test.
Confirms before any destructive action. Takes no arguments.
EOF
    exit 0
    ;;
esac

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

COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)

# ── Stop every service holding a DB connection (keep db running) ──
# DROP DATABASE fails while ANY session is connected. The Supabase sidecars
# (auth/rest/realtime/storage) keep persistent pools to ${POSTGRES_DB}, so they
# must be stopped too — not just the app tier. The final `up -d` brings them back.
hdr "Stopping services connected to the database"

"${COMPOSE[@]}" stop \
  api web-public web-scoring web-admin worker \
  supabase-auth supabase-rest supabase-realtime supabase-storage
ok "Services stopped"

# ── Restore database ─────────────────────────────────────────────
if [[ "$BACKUP_FILE" != "none" && -f "$BACKUP_FILE" ]]; then
  hdr "Restoring database from $BACKUP_FILE"

  # Drop + recreate cleanly. WITH (FORCE) terminates any straggler backend
  # (PG13+) — belt-and-suspenders now that the connected services are stopped.
  "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB}\" WITH (FORCE);"
  "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "CREATE DATABASE \"${POSTGRES_DB}\";"

  # Replay in a single transaction with ON_ERROR_STOP so a truncated or corrupt
  # dump rolls the fresh database back to empty instead of leaving a half-restored,
  # incoherent database reported as "success".
  gunzip -c "$BACKUP_FILE" \
    | "${COMPOSE[@]}" exec -T db \
        psql -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  ok "Postgres restored from $BACKUP_FILE"

  # ── Validate schema coherence before declaring success ─────────
  hdr "Validating restored database"
  validate_query() {
    "${COMPOSE[@]}" exec -T db \
      psql -v ON_ERROR_STOP=1 -tAX -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1" \
      | tr -d '[:space:]'
  }
  for schema in public auth storage; do
    if [[ "$(validate_query "SELECT count(*) FROM information_schema.schemata WHERE schema_name='${schema}';")" != "1" ]]; then
      err "Restore validation FAILED: schema '${schema}' missing — restored database is not coherent"
      exit 1
    fi
  done
  PUBLIC_TABLES=$(validate_query "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
  if [[ "${PUBLIC_TABLES:-0}" -lt 10 ]]; then
    err "Restore validation FAILED: only ${PUBLIC_TABLES:-0} public tables present — restore looks incomplete"
    exit 1
  fi
  ok "Restore validation passed (public tables=${PUBLIC_TABLES})"
fi

# ── Reset git ────────────────────────────────────────────────────
hdr "Resetting code to $PREV_COMMIT"

git reset --hard "$PREV_COMMIT"
ok "Code reset"

# ── Rebuild ──────────────────────────────────────────────────────
hdr "Rebuilding images"

"${COMPOSE[@]}" build
ok "Images built"

# ── Restart ──────────────────────────────────────────────────────
hdr "Starting stack"

"${COMPOSE[@]}" up -d
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
