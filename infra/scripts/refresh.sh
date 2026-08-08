#!/usr/bin/env bash
# infra/scripts/refresh.sh — restart a specific service (or all) and wait for health
#
# Restart only — this does NOT rebuild images. To pick up a code change, use
# redeploy.sh (rebuild + recreate). For a full deploy, use deploy.sh.
#
# Usage:
#   infra/scripts/refresh.sh             # restart all app services
#   infra/scripts/refresh.sh api         # restart just one service
#   infra/scripts/refresh.sh api worker  # restart multiple

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

# Exports TRAEFIK_BAN_ALLOWLIST + the MW_* middleware prefixes that
# docker-compose.prod.yml interpolates. Compose reads these from this shell,
# not from --env-file, so EVERY script that runs a compose command must source
# it — otherwise compose warns about unset variables and, for the scripts that
# bring the stack up, silently detaches the GeoBlock/Fail2Ban middlewares.
source "$SCRIPT_DIR/lib/traefik-env.sh"

usage() {
  cat <<'EOF'
Usage: infra/scripts/refresh.sh [service...]

Restart running containers and wait for health. Does NOT rebuild images —
use redeploy.sh to pick up a code change.

  (no service)  Restart all app services: api web-public web-staff web-admin web-marketing worker
  service...    Restart only the named services.
  -h, --help    Show this help.
EOF
}

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
  esac
done

[[ -f .env ]] || { err "Missing .env"; exit 1; }

COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)

if [[ $# -eq 0 ]]; then
  SERVICES=(api web-public web-staff web-admin web-marketing worker)
else
  SERVICES=("$@")
fi

hdr "Restarting: ${SERVICES[*]}"
"${COMPOSE[@]}" restart "${SERVICES[@]}"
ok "Restart command issued"

# Health wait
hdr "Waiting for services to come back"
RETRIES=15
DELAY=2
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
      err "$svc did not come back ($HEALTH after $((RETRIES * DELAY))s)"
      err "Check: ${COMPOSE[*]} logs --tail=50 $svc"
      exit 1
    fi
    sleep "$DELAY"
  done
done

echo
ok "Refresh complete"
