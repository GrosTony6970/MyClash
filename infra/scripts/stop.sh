#!/usr/bin/env bash
# infra/scripts/stop.sh — stop the stack without removing containers/volumes

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
cd "$(cd "$SCRIPT_DIR/../.." && pwd)"

hdr "Validating configuration"
[[ -f .env ]] || { err "Missing .env"; exit 1; }
ok ".env found"

hdr "Stopping containers"
docker compose --env-file .env -f infra/docker-compose.prod.yml stop
ok "Stack stopped"

echo
docker compose --env-file .env -f infra/docker-compose.prod.yml ps
