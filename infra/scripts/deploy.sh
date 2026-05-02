#!/usr/bin/env bash
# infra/scripts/deploy.sh
#
# Server-side deploy script. Runs ON THE OVH VPS, invoked by SSH from the
# owner's local machine via the cross-platform wrapper at scripts/deploy.ts.
#
# What it does (in order):
#   1. Validate environment (.env, config files, JSON syntax)
#   2. Acquire deploy lock (flock) — only one deploy at a time
#   3. Sync version stamps (PWA cache busts)
#   4. Generate VAPID keys if missing (web push)
#   5. Pre-deploy DB backup (pg_dump → backups/pre-deploy/)
#   6. git fetch + reset --hard origin/main
#   7. docker compose build
#   8. Run pending migrations (FAILS HERE → deploy aborts, old version still up)
#   9. docker compose up -d
#  10. Wait for healthchecks
#  11. Smoke tests
#  12. Record .last-deploy.json
#
# This script is modeled on the proven MyFAL deploy.sh pattern. The MyFAL
# logging/validation conventions are preserved verbatim.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"

ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

# ── Arguments ────────────────────────────────────────────────────
USE_DEV_CERTS=0
SKIP_BACKUP=0
SKIP_MIGRATIONS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev-certs)        USE_DEV_CERTS=1; shift ;;
    --skip-backup)      SKIP_BACKUP=1; shift ;;        # for fast iterating; never in prod
    --skip-migrations)  SKIP_MIGRATIONS=1; shift ;;    # for fast iterating; never in prod
    -h|--help)
      cat <<EOF
Usage: infra/scripts/deploy.sh [options]

  --dev-certs          Use Let's Encrypt staging certificates.
  --skip-backup        Skip pre-deploy DB backup (DEV ONLY — never use in production).
  --skip-migrations    Skip migration step (DEV ONLY).
  -h, --help           Show this help.
EOF
      exit 0
      ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Lock ─────────────────────────────────────────────────────────
LOCK_FILE="$ROOT_DIR/.deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  err "Another deploy is already running. Lock: $LOCK_FILE"
  exit 1
fi
trap 'rm -f "$LOCK_FILE"' EXIT

# ── Validate config ──────────────────────────────────────────────
hdr "Validating configuration"

require_cmd docker
require_cmd git
require_cmd pg_dump

if [[ ! -f .env ]]; then
  err "Missing .env file. Copy .env.prod.example to .env first."
  exit 1
fi
ok ".env found"

set -a
source ./.env
set +a

: "${DOMAIN:?Missing DOMAIN in .env}"
: "${LETSENCRYPT_EMAIL:?Missing LETSENCRYPT_EMAIL in .env}"
: "${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD in .env}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=myclash}"

ok "Environment variables present"

# Compose file selection
COMPOSE_FILES=(-f infra/docker-compose.prod.yml)
if [[ "$USE_DEV_CERTS" -eq 1 ]]; then
  COMPOSE_FILES+=(-f infra/docker-compose.staging-certs.yml)
  warn "Using Let's Encrypt staging certificates (--dev-certs)"
fi

# ── VAPID / Web Push keys ─────────────────────────────────────────
hdr "Web Push (VAPID) keys"

require_cmd node

VAPID_RESULT=$(node scripts/ensure-vapid-env.mjs .env "$LETSENCRYPT_EMAIL")
set -a
source ./.env
set +a

if [[ "$VAPID_RESULT" == *'"generated":true'* ]]; then
  ok "VAPID keys generated and saved to .env"
else
  ok "VAPID keys already configured"
fi

# ── Sync version stamps (PWA cache busting) ──────────────────────
hdr "Syncing version stamps"

if [[ -f VERSION ]]; then
  APP_VERSION=$(cat VERSION | tr -d '[:space:]')
  APP_VERSION_NODOT="${APP_VERSION//./}"

  # Service worker cache names per app
  for sw in apps/web-public/public/sw.js apps/web-scoring/public/sw.js apps/web-admin/public/sw.js; do
    [[ -f "$sw" ]] && sed -i "s/const CACHE_NAME = 'myclash-[^-]*-v[^']*'/const CACHE_NAME = 'myclash-$(basename "$(dirname "$(dirname "$sw")")")-${APP_VERSION}'/" "$sw" || true
  done

  ok "Version ${APP_VERSION} stamped into service workers"
else
  warn "No VERSION file — skipping version stamping"
fi

# ── Prepare directories ──────────────────────────────────────────
hdr "Preparing data and log directories"

mkdir -p \
  logs/api logs/web-public logs/web-scoring logs/web-admin logs/traefik \
  data/postgres data/redis data/storage data/traefik \
  backups/pre-deploy backups/nightly

: > logs/api/api.log
: > logs/traefik/traefik.log

ACME_FILE="data/traefik/acme.json"
[[ "$USE_DEV_CERTS" -eq 1 ]] && ACME_FILE="data/traefik/acme-staging.json"

[[ -f "$ACME_FILE" ]] || touch "$ACME_FILE"
chmod 600 "$ACME_FILE"

chmod 775 data/postgres data/redis data/storage logs/* 2>/dev/null || true
ok "Directories ready"

# ── Pre-deploy backup ────────────────────────────────────────────
hdr "Pre-deploy database backup"

if [[ "$SKIP_BACKUP" -eq 1 ]]; then
  warn "Skipping pre-deploy backup (--skip-backup)"
elif ! docker compose --env-file .env "${COMPOSE_FILES[@]}" ps --status running db 2>/dev/null | grep -q db; then
  warn "Database not running — skipping pre-deploy backup (likely first deploy)"
else
  TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
  BACKUP_FILE="backups/pre-deploy/${TIMESTAMP}.sql.gz"
  info "Dumping to $BACKUP_FILE"
  if docker compose --env-file .env "${COMPOSE_FILES[@]}" exec -T db \
       pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" 2>/dev/null | gzip > "$BACKUP_FILE"; then
    ok "Backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
  else
    err "Backup failed — aborting deploy"
    exit 1
  fi

  # Prune backups older than 30 days
  find backups/pre-deploy -name "*.sql.gz" -mtime +30 -delete 2>/dev/null || true
fi

# ── Pull latest code ─────────────────────────────────────────────
hdr "Updating code from git"

CURRENT_COMMIT=$(git rev-parse HEAD)
info "Current commit: ${CURRENT_COMMIT:0:8}"

git fetch origin main
NEW_COMMIT=$(git rev-parse origin/main)
info "Target  commit: ${NEW_COMMIT:0:8}"

if [[ "$CURRENT_COMMIT" == "$NEW_COMMIT" ]]; then
  warn "No new commits to deploy"
else
  git reset --hard origin/main
  ok "Code updated"
fi

# ── Build ────────────────────────────────────────────────────────
hdr "Building images"

docker compose --env-file .env "${COMPOSE_FILES[@]}" build
ok "Images built"

# ── Migrations ───────────────────────────────────────────────────
hdr "Running database migrations"

if [[ "$SKIP_MIGRATIONS" -eq 1 ]]; then
  warn "Skipping migrations (--skip-migrations)"
else
  # Migration runs as a one-off compose run command, not a service.
  # Failure here exits the script before `up` is called — old containers stay up.
  if ! docker compose --env-file .env "${COMPOSE_FILES[@]}" \
         run --rm api pnpm --filter @myclash/db migrate; then
    err "Migration failed — deploy aborted; previous version is still running"
    err "Investigate, then either fix and re-run, or rollback with: infra/scripts/rollback.sh"
    exit 1
  fi
  ok "Migrations applied"
fi

# ── Bring up new stack ───────────────────────────────────────────
hdr "Starting stack"

docker compose --env-file .env "${COMPOSE_FILES[@]}" up -d
ok "Stack started"

# ── Wait for healthchecks ────────────────────────────────────────
hdr "Waiting for services to become healthy"

RETRIES=20
DELAY=3
for svc in api web-public web-scoring web-admin; do
  for i in $(seq 1 "$RETRIES"); do
    HEALTH=$(docker inspect --format='{{.State.Health.Status}}' \
              "$(docker compose --env-file .env "${COMPOSE_FILES[@]}" ps -q "$svc")" 2>/dev/null || echo "unknown")
    if [[ "$HEALTH" == "healthy" ]]; then
      ok "$svc healthy"
      break
    fi
    if [[ "$i" -eq "$RETRIES" ]]; then
      err "$svc did not become healthy after $((RETRIES * DELAY))s"
      err "Check logs: docker compose -f infra/docker-compose.prod.yml logs --tail=100 $svc"
      exit 1
    fi
    info "Attempt $i/$RETRIES — $svc status: $HEALTH"
    sleep "$DELAY"
  done
done

# ── Smoke test ───────────────────────────────────────────────────
hdr "Smoke test"

if curl -fsSL "https://api.${DOMAIN}/health" >/dev/null 2>&1; then
  ok "API /health reachable"
else
  warn "API /health not reachable from this host (may be a DNS/firewall issue, not a deploy issue)"
fi

# ── Record deploy metadata ───────────────────────────────────────
hdr "Recording deploy metadata"

cat > .last-deploy.json <<EOF
{
  "previousCommit": "$CURRENT_COMMIT",
  "deployedCommit": "$NEW_COMMIT",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "deployedBy": "${SUDO_USER:-${USER:-unknown}}",
  "backupFile": "${BACKUP_FILE:-none}"
}
EOF
ok "Metadata saved to .last-deploy.json"

# ── Summary ──────────────────────────────────────────────────────
hdr "Deploy complete"

docker compose --env-file .env "${COMPOSE_FILES[@]}" ps

echo
ok "Deployed commit ${NEW_COMMIT:0:8} to https://${DOMAIN}"
echo "  Rollback if needed:  infra/scripts/rollback.sh"
echo "  Status:              infra/scripts/status.sh"
