#!/usr/bin/env bash
# infra/scripts/destroy.sh — REMOVE containers, images, and runtime data
#
# DESTRUCTIVE. Use only on dev/staging or when intentionally rebuilding from scratch.
# Postgres data is preserved by default (named volume); use --wipe-db to also remove it.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
cd "$(cd "$SCRIPT_DIR/../.." && pwd)"

WIPE_DB=0
FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --wipe-db) WIPE_DB=1; shift ;;
    --force)   FORCE=1; shift ;;
    -h|--help)
      echo "Usage: infra/scripts/destroy.sh [--wipe-db] [--force]"
      echo
      echo "  --wipe-db    Also remove Postgres + Redis volumes (DESTROYS ALL DATA)"
      echo "  --force      Skip confirmation prompt"
      exit 0
      ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

hdr "Removing stack"

if [[ "$WIPE_DB" -eq 1 ]]; then
  warn "This will DELETE all containers, images, AND POSTGRES + REDIS DATA"
else
  warn "This will remove containers and images but PRESERVE Postgres + Redis data"
fi

if [[ "$FORCE" -ne 1 ]]; then
  confirm "Are you sure?" || { warn "Aborted."; exit 0; }
fi

COMPOSE=(docker compose --env-file .env -f infra/docker-compose.prod.yml)

if [[ "$WIPE_DB" -eq 1 ]]; then
  "${COMPOSE[@]}" down --rmi local --remove-orphans -v
  ok "Containers, images, AND volumes removed"
else
  "${COMPOSE[@]}" down --rmi local --remove-orphans
  ok "Containers and images removed (volumes preserved)"
fi

# Clean transient runtime files (not data, not backups)
rm -f data/traefik/acme.json data/traefik/acme-staging.json
rm -f logs/api/api.log logs/traefik/traefik.log
rm -f .last-deploy.json
ok "Runtime files cleaned"

echo
ok "Stack removed"
[[ "$WIPE_DB" -eq 1 ]] && warn "All data was destroyed. To restore from backup: infra/scripts/restore.sh"
