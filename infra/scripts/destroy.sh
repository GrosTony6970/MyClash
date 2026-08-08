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
#
# --force    Skip every confirmation, including the --full one. Combine as
#            `./destroy.sh --full --force` for an unattended wipe.
#
# destroy.sh <service...>   Selective: stop & remove only the named containers
#            (docker compose rm -sf). Volumes, images, data/, logs/, and every other
#            container are preserved. Pair with `redeploy.sh <service>` to recreate.
#            Cannot be combined with --wipe-db / --full (those are whole-stack ops).

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
Usage: infra/scripts/destroy.sh [--wipe-db|--full] [--force]
       infra/scripts/destroy.sh <service...> [--force]

  (no args)    Remove containers + locally-built images. ALL data preserved.
  --wipe-db    Also remove Docker volumes (postgres, redis, storage data).
               data/ folder and logs/ are kept.
  --full       Complete reset: volumes + data/ + logs/ destroyed.
               backups/ and .env are NEVER touched.
  <service...> Selective: stop & remove only the named containers.
               Volumes, images, data/, logs/, and other containers preserved.
               Cannot be combined with --wipe-db / --full.
  --force      Skip ALL confirmation prompts, including the second
               "this cannot be undone" gate on --full. Intended for
               scripted wipe-and-redeploy: ./destroy.sh --full --force
  -h, --help   Show this help.
EOF
}

WIPE_DB=0
FULL=0
FORCE=0
SERVICES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --wipe-db) WIPE_DB=1; shift ;;
    --full)    FULL=1; shift ;;
    --force)   FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) err "Unknown option: $1"; exit 1 ;;
    *)  SERVICES+=("$1"); shift ;;
  esac
done

COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)

# ── Selective mode: remove only the named containers ─────────────
if [[ "${#SERVICES[@]}" -gt 0 ]]; then
  if [[ "$WIPE_DB" -eq 1 || "$FULL" -eq 1 ]]; then
    err "Service names cannot be combined with --wipe-db / --full (whole-stack ops)."
    exit 1
  fi

  hdr "Removing containers: ${SERVICES[*]}"
  warn "Stops & removes only these containers: ${SERVICES[*]}"
  warn "Preserved:  Docker volumes  images  data/  logs/  backups/  .env  (all other containers)"

  if [[ "$FORCE" -ne 1 ]]; then
    confirm "Are you sure?" || { warn "Aborted."; exit 0; }
  fi

  "${COMPOSE[@]}" rm -sf "${SERVICES[@]}"
  echo
  ok "Removed containers: ${SERVICES[*]}"
  warn "Recreate with: infra/scripts/redeploy.sh ${SERVICES[*]}"
  exit 0
fi

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

# Second gate for --full. --force skips it: a full wipe + redeploy is the
# operator's normal cadence, and a prompt that cannot be answered is worse than
# no prompt in a non-interactive run (`confirm` reads stdin, so under CI or a
# pipe it consumes EOF, returns non-zero and "aborts" a destroy that was
# explicitly requested). The warning is still printed either way so the run log
# always records what was about to be deleted.
if [[ "$FULL" -eq 1 ]]; then
  warn "⚠  This will permanently delete data/ and logs/. This cannot be undone."
  if [[ "$FORCE" -ne 1 ]]; then
    confirm "Confirm full reset?" || { warn "Aborted."; exit 0; }
  fi
fi

if [[ "$WIPE_DB" -eq 1 ]]; then
  "${COMPOSE[@]}" down --rmi local --remove-orphans -v
  # Belt-and-suspenders: compose down -v can silently skip volumes when a container
  # holds a file lock; remove them explicitly so a partial init never persists.
  docker volume rm myclash-postgres-data myclash-redis-data myclash-storage-data \
    2>/dev/null || true
  ok "Containers, images, and Docker volumes removed"
else
  "${COMPOSE[@]}" down --rmi local --remove-orphans
  ok "Containers and images removed (all data preserved)"
fi

if [[ "$FULL" -eq 1 ]]; then
  rm -rf data/traefik data/postgres data/redis data/storage
  rm -rf logs/api logs/traefik logs/web-public logs/web-staff logs/web-admin logs/db
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
