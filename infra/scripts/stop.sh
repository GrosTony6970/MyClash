#!/usr/bin/env bash
# infra/scripts/stop.sh — stop the stack without removing containers/volumes

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

case "${1:-}" in
  -h|--help)
    echo "Usage: infra/scripts/stop.sh"
    echo
    echo "Stop the stack (docker compose stop) without removing containers or volumes."
    exit 0
    ;;
esac

hdr "Validating configuration"
[[ -f .env ]] || { err "Missing .env"; exit 1; }
ok ".env found"

hdr "Stopping containers"
docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml stop
ok "Stack stopped"

echo
docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml ps
