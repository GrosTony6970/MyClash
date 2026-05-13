#!/usr/bin/env bash
# infra/scripts/start.sh — start the stack without rebuilding/redeploying

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
cd "$(cd "$SCRIPT_DIR/../.." && pwd)"

hdr "Validating configuration"
[[ -f .env ]] || { err "Missing .env"; exit 1; }
ok ".env found"

hdr "Starting containers"
docker compose --env-file .env -f infra/docker-compose.prod.yml up -d
ok "Stack started"

echo
docker compose --env-file .env -f infra/docker-compose.prod.yml ps
