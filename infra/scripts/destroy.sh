#!/usr/bin/env bash
# infra/scripts/destroy.sh — Remove containers, images, and optionally all data
#
# Default: stops containers and removes locally-built images only.
#          All persistent state is preserved (DB, certs, logs, uploads).
#
# --wipe-db  Also remove Docker volumes (postgres, redis, storage).
#            data/ folder and logs/ are kept.
#
# --full     Complete reset: volumes + data/ + logs/ + runtime files.
#            backups/ and .env are NEVER touched.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

WIPE_DB=0
FULL=0
FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --wipe-db) WIPE_DB=1; shift ;;
    --full)    FULL=1; shift ;;
    --force)   FORCE=1; shift ;;
    -h|--help)
      echo "Usage: infra/scripts/destroy.sh [--wipe-db|--full] [--force]"
      echo
      echo "  (no flags)   Remove containers + locally-built images. ALL data preserved."
      echo "  --wipe-db    Also remove Docker volumes (postgres, redis, storage data)."
      echo "               data/ folder and logs/ are kept."
      echo "  --full       Complete reset: volumes + data/ + logs/ destroyed."
      echo "               backups/ and .env are NEVER touched."
      echo "  --force      Skip confirmation prompt"
      exit 0
      ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

# --full implies --wipe-db
if [[ "$FULL" -eq 1 ]]; then
  WIPE_DB=1
fi

hdr "Removing stack"

if [[ "$FULL" -eq 1 ]]; then
  warn "FULL RESET: will delete containers, images, Docker volumes, data/, and logs/"
  warn "Preserved:  backups/  .env"
elif [[ "$WIPE_DB" -eq 1 ]]; then
  warn "This will DELETE containers, images, and Docker volumes (postgres + redis + storage)"
  warn "Preserved:  data/  logs/  backups/  .env"
else
  warn "This will remove containers and locally-built images"
  warn "Preserved:  Docker volumes  data/  logs/  backups/  .env"
fi

if [[ "$FORCE" -ne 1 ]]; then
  confirm "Are you sure?" || { warn "Aborted."; exit 0; }
fi

# Extra confirmation for --full even with --force
if [[ "$FULL" -eq 1 ]]; then
  warn "⚠  This will permanently delete data/ and logs/. This cannot be undone."
  confirm "Confirm full reset?" || { warn "Aborted."; exit 0; }
fi

COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)

if [[ "$WIPE_DB" -eq 1 ]]; then
  "${COMPOSE[@]}" down --rmi local --remove-orphans -v
  ok "Containers, images, and Docker volumes removed"
else
  "${COMPOSE[@]}" down --rmi local --remove-orphans
  ok "Containers and images removed (all data preserved)"
fi

if [[ "$FULL" -eq 1 ]]; then
  rm -rf data/traefik data/postgres data/redis data/storage
  rm -rf logs/api logs/traefik logs/web-public logs/web-scoring logs/web-admin logs/db
  rm -f .last-deploy.json
  ok "data/, logs/, and runtime files removed"
fi

echo
ok "Stack removed"
if [[ "$FULL" -eq 1 ]]; then
  warn "Full reset complete. To restore from backup: infra/scripts/restore.sh"
elif [[ "$WIPE_DB" -eq 1 ]]; then
  warn "Docker volumes destroyed. To restore from backup: infra/scripts/restore.sh"
fi
