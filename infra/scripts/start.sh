#!/usr/bin/env bash
# infra/scripts/start.sh — start the stack without rebuilding/redeploying

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

# See deploy.sh — Compose reads these from the invoking shell, not --env-file.
# This is also the script used to recover from a failed plugin fetch:
#   TRAEFIK_PLUGINS=off ./infra/scripts/start.sh
source "$SCRIPT_DIR/lib/traefik-env.sh"

# This script creates containers without deploying, and Compose binds the deploy
# manifest by path at create time — a missing path becomes a directory the api
# container then reads for its whole life. refresh.sh does not need this: it only
# `restart`s existing containers and never binds a fresh mount source.
source "$SCRIPT_DIR/lib/system-versions.sh"

usage() {
  cat <<'EOF'
Usage: infra/scripts/start.sh

Start the stack (docker compose up -d) without rebuilding or redeploying.
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

mc_ensure_system_versions_manifest

hdr "Starting containers"
"${COMPOSE[@]}" up -d
ok "Stack started"

# Traefik boots even when its plugins fail to fetch, so nothing else would tell
# the operator the edge lost GeoBlock/Fail2Ban. Non-fatal: report, don't block.
mc_warn_if_plugins_failed || true
# ...and the log grep only catches a failed download. This proves the plugin
# middlewares actually BUILT and are attached to their routers.
mc_verify_edge_plugins || true

echo
"${COMPOSE[@]}" ps
