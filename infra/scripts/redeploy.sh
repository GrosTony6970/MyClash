#!/usr/bin/env bash
# infra/scripts/redeploy.sh — rebuild + recreate specific app services in place
#
# The middle ground between the two existing tools:
#   refresh.sh   restart only — does NOT rebuild the image (config/env reload).
#   redeploy.sh  rebuild + recreate just the named app service(s).  ← this script
#   deploy.sh    full safe deploy (git reset, build ALL, migrate, up ALL, bootstrap).
#
# Only the named services are rebuilt and recreated (via `--no-deps`); every other
# container — db, redis, supabase-*, traefik, and the other apps — keeps running
# untouched. Use this for a fast single-app iteration without a whole-stack redeploy.
#
# Usage:
#   infra/scripts/redeploy.sh                # all app services (api web-public web-scoring web-admin web-marketing worker)
#   infra/scripts/redeploy.sh api worker     # only these
#   infra/scripts/redeploy.sh web-admin
#   infra/scripts/redeploy.sh api --pull     # git fetch + reset --hard origin/main first
#   infra/scripts/redeploy.sh api --migrate  # run pending migrations before recreate
#
# Options:
#   --pull        Update code (git fetch + reset --hard origin/main) and re-stamp PWA
#                 service-worker cache names before building. Default: build current checkout.
#   --migrate     Run pending DB migrations after build, before recreate (api/worker changes).
#   --no-build    Recreate from the existing image without rebuilding (a hard restart).
#   --dev-certs   Add the Let's Encrypt staging-certs compose overlay (config parity).
#   -h, --help    Show this help.

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: infra/scripts/redeploy.sh [service...] [options]

Rebuild + recreate only the named app services, leaving every other container
(db, redis, supabase-*, traefik, and the other apps) running untouched.

  (no service)  Redeploy all app services: api web-public web-scoring web-admin web-marketing worker
  service...    One or more of: api worker web-public web-scoring web-admin web-marketing

Options:
  --pull        git fetch + reset --hard origin/main (+ PWA stamp) before building.
  --migrate     Run pending DB migrations after build, before recreate.
  --no-build    Recreate from the existing image without rebuilding.
  --dev-certs   Add the staging-certs compose overlay.
  -h, --help    Show this help.
EOF
}

# ── Arguments ────────────────────────────────────────────────────
PULL=0
MIGRATE=0
NO_BUILD=0
USE_DEV_CERTS=0
SERVICES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull)       PULL=1; shift ;;
    --migrate)    MIGRATE=1; shift ;;
    --no-build)   NO_BUILD=1; shift ;;
    --dev-certs)  USE_DEV_CERTS=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    -*)           err "Unknown option: $1"; err "Run 'redeploy.sh --help' for usage."; exit 1 ;;
    *)            SERVICES+=("$1"); shift ;;
  esac
done

# Default to the full app set (matches refresh.sh).
if [[ "${#SERVICES[@]}" -eq 0 ]]; then
  SERVICES=(api web-public web-scoring web-admin web-marketing worker)
fi

# ── Validate service names ───────────────────────────────────────
# Only locally-built app services can be redeployed. Infra/stateful services use a
# public image and are not rebuilt here.
ALLOWED=(api worker web-public web-scoring web-admin web-marketing)
is_allowed() {
  local s="$1" a
  for a in "${ALLOWED[@]}"; do [[ "$s" == "$a" ]] && return 0; done
  return 1
}
for svc in "${SERVICES[@]}"; do
  if ! is_allowed "$svc"; then
    err "Not a redeployable app service: $svc"
    err "Allowed: ${ALLOWED[*]}"
    err "For infra (db, redis, traefik, supabase-*): use 'refresh.sh $svc' to restart,"
    err "or 'deploy.sh' for a full deploy."
    exit 1
  fi
done

# ── Environment ──────────────────────────────────────────────────
[[ -f .env ]] || { err "Missing .env"; exit 1; }
# Load .env so compose build args (NEXT_PUBLIC_*, GIT_COMMIT, …) interpolate correctly.
set -a
source ./.env
set +a

# ── Lock ─────────────────────────────────────────────────────────
# Share the deploy lock so a redeploy can't race deploy.sh / rollback.sh.
LOCK_FILE="$ROOT_DIR/.deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  err "Another deploy/redeploy is already running. Lock: $LOCK_FILE"
  exit 1
fi
trap 'rm -f "$LOCK_FILE"' EXIT

# ── Compose file selection ───────────────────────────────────────
COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)
if [[ "$USE_DEV_CERTS" -eq 1 ]]; then
  COMPOSE+=(-f infra/docker-compose.staging-certs.yml)
  # The overlay no longer redefines traefik's command; it selects the staging CA
  # through these two vars instead. Exported (not passed via --env-file) so they
  # win over .env in Compose's interpolation precedence.
  export ACME_STORAGE_FILE=acme-staging.json
  export ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory
  warn "Using Let's Encrypt staging certificates (--dev-certs)"
fi

hdr "Redeploying: ${SERVICES[*]}"

# ── Optional: pull latest code + re-stamp PWA caches ─────────────
if [[ "$PULL" -eq 1 ]]; then
  hdr "Updating code from git"
  CURRENT_COMMIT=$(git rev-parse HEAD)
  info "Current commit: ${CURRENT_COMMIT:0:8}"
  git fetch origin main
  NEW_COMMIT=$(git rev-parse origin/main)
  info "Target  commit: ${NEW_COMMIT:0:8}"
  if [[ "$CURRENT_COMMIT" == "$NEW_COMMIT" ]]; then
    warn "No new commits — rebuilding current checkout"
  else
    git reset --hard origin/main
    ok "Code updated"
  fi

  # Re-stamp service-worker cache names so PWAs cache-bust (same as deploy.sh).
  if [[ -f VERSION ]]; then
    APP_VERSION=$(tr -d '[:space:]' < VERSION)
    for sw in apps/web-public/public/sw.js apps/web-scoring/public/sw.js apps/web-admin/public/sw.js; do
      [[ -f "$sw" ]] && sed -i "s/const CACHE_NAME = 'myclash-[^-]*-v[^']*'/const CACHE_NAME = 'myclash-$(basename "$(dirname "$(dirname "$sw")")")-${APP_VERSION}'/" "$sw" || true
    done
    ok "Version ${APP_VERSION} stamped into service workers"
  fi
fi

# GIT_COMMIT feeds compose build args; always reflect the checkout being built.
GIT_COMMIT="$(git rev-parse HEAD)"
export GIT_COMMIT

# ── Build ────────────────────────────────────────────────────────
if [[ "$NO_BUILD" -eq 1 ]]; then
  warn "Skipping build (--no-build) — recreating from existing image"
else
  hdr "Building: ${SERVICES[*]}"
  "${COMPOSE[@]}" build "${SERVICES[@]}"
  ok "Images built"
fi

# ── Optional: migrations ─────────────────────────────────────────
if [[ "$MIGRATE" -eq 1 ]]; then
  hdr "Running database migrations"
  if ! "${COMPOSE[@]}" run --rm api node packages/db/scripts/migrate.mjs; then
    err "Migration failed — aborting before recreate; current containers still running"
    exit 1
  fi
  ok "Migrations applied"
fi

# ── Recreate only the named services (no dependencies) ───────────
hdr "Recreating: ${SERVICES[*]}"
# --no-deps     don't touch depends_on services (recreating web-admin would otherwise
#               bounce api; recreating api would bounce db/redis).
# --force-recreate  guarantee the container picks up the freshly built image.
# Bound `up -d` with a hard timeout: compose's progress renderer can park on the last
# frame over SSH even when containers are healthy. An interrupted `up -d` (124 timeout,
# 137 SIGKILL/OOM, 143 SIGTERM) falls through to the health poll below, which is the real
# source of truth; any other non-zero is a real failure.
#
# Capture the exit code with `|| rc=$?` — NOT `if ! cmd; then rc=$?`. Inside a negated
# `if`, `$?` holds the *inverted* status (always 0 when the branch runs), so the old
# form silently reported every failure as "exit 0".
UP_TIMEOUT=120
rc=0
timeout --kill-after=10 "$UP_TIMEOUT" \
  "${COMPOSE[@]}" up -d --no-deps --force-recreate "${SERVICES[@]}" || rc=$?
if [[ "$rc" -ne 0 ]]; then
  if [[ "$rc" -eq 124 || "$rc" -eq 137 || "$rc" -eq 143 ]]; then
    warn "docker compose up -d exited abnormally (code $rc: timeout/killed) — verifying via healthcheck poll"
  else
    err "docker compose up -d failed (exit $rc)"
    exit 1
  fi
fi
ok "Recreate command issued"

# ── Wait for health ──────────────────────────────────────────────
hdr "Waiting for services to become healthy"
RETRIES=20
DELAY=3
for svc in "${SERVICES[@]}"; do
  for i in $(seq 1 "$RETRIES"); do
    ID=$("${COMPOSE[@]}" ps -q "$svc" 2>/dev/null || true)
    if [[ -z "$ID" ]]; then
      warn "$svc: container not found"
      break
    fi
    HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$ID")
    if [[ "$HEALTH" == "healthy" || "$HEALTH" == "running" ]]; then
      ok "$svc: $HEALTH"
      break
    fi
    if [[ "$i" -eq "$RETRIES" ]]; then
      err "$svc did not become healthy after $((RETRIES * DELAY))s ($HEALTH)"
      err "Check: ${COMPOSE[*]} logs --tail=100 $svc"
      exit 1
    fi
    info "Attempt $i/$RETRIES — $svc status: $HEALTH"
    sleep "$DELAY"
  done
done

# ── Smoke test (if api was redeployed) ───────────────────────────
for svc in "${SERVICES[@]}"; do
  if [[ "$svc" == "api" ]]; then
    hdr "Smoke test"
    if curl -fsSL "https://api.${DOMAIN}/health" >/dev/null 2>&1; then
      ok "API /health reachable"
    else
      warn "API /health not reachable from this host (may be DNS/firewall, not a deploy issue)"
    fi
    break
  fi
done

# ── Summary ──────────────────────────────────────────────────────
hdr "Redeploy complete"
"${COMPOSE[@]}" ps "${SERVICES[@]}"
echo
ok "Redeployed: ${SERVICES[*]}"
