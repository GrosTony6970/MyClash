#!/usr/bin/env bash
# infra/scripts/refresh.sh — restart a specific service (or all) and wait for health
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

[[ -f .env ]] || { err "Missing .env"; exit 1; }

COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)

if [[ $# -eq 0 ]]; then
  SERVICES=(api web-public web-scoring web-admin worker)
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
