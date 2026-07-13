#!/usr/bin/env bash
# infra/scripts/stop.sh — stop the stack without removing containers/volumes

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: infra/scripts/stop.sh

Stop the stack (docker compose stop) without removing containers or volumes.
  -h, --help   Show this help.
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)

hdr "Validating configuration"
[[ -f .env ]] || { err "Missing .env"; exit 1; }
ok ".env found"

hdr "Stopping containers"
"${COMPOSE[@]}" stop
ok "Stack stopped"

echo
"${COMPOSE[@]}" ps
