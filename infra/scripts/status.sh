#!/usr/bin/env bash
# infra/scripts/status.sh — comprehensive status check
# Modeled on MyFAL status.sh; extended for MyClash's multi-service stack.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
cd "$(cd "$SCRIPT_DIR/../.." && pwd)"

[[ -f .env ]] || { err "Missing .env"; exit 1; }

COMPOSE=(docker compose --env-file .env -f infra/docker-compose.prod.yml)

# ── Containers ───────────────────────────────────────────────────
hdr "Docker Compose"
"${COMPOSE[@]}" ps || true

# ── Container health per service ─────────────────────────────────
hdr "Container health"

for svc in api web-public web-scoring web-admin worker db redis traefik; do
  ID=$("${COMPOSE[@]}" ps -q "$svc" 2>/dev/null || true)
  if [[ -z "$ID" ]]; then
    warn "$svc: not running"
    continue
  fi
  HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$ID" 2>/dev/null || echo "unknown")
  case "$HEALTH" in
    healthy)   ok   "$svc: healthy" ;;
    running)   ok   "$svc: running (no healthcheck)" ;;
    unhealthy) err  "$svc: unhealthy" ;;
    starting)  warn "$svc: starting" ;;
    *)         warn "$svc: $HEALTH" ;;
  esac
done

# ── Last deploy ──────────────────────────────────────────────────
hdr "Last deploy"

if [[ -f .last-deploy.json ]] && command -v jq &>/dev/null; then
  jq -r '"  Commit:     \(.deployedCommit[0:8])\n  Deployed:   \(.deployedAt)\n  By:         \(.deployedBy)\n  Backup:     \(.backupFile)\n  Rollback?:  \(.isRollback // false)"' .last-deploy.json
else
  warn "No deploy metadata"
fi

# ── API /health ─────────────────────────────────────────────────
hdr "API health endpoint"

if "${COMPOSE[@]}" exec -T api wget -qO- http://localhost:4000/health 2>/dev/null; then
  echo
  ok "API /health reachable from container"
else
  warn "API /health not reachable inside container"
fi

# ── API /version ────────────────────────────────────────────────
hdr "API version"

if "${COMPOSE[@]}" exec -T api wget -qO- http://localhost:4000/version 2>/dev/null; then
  echo
else
  warn "API /version not reachable"
fi

# ── DB health ────────────────────────────────────────────────────
hdr "Postgres"

set -a; source ./.env; set +a
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=myclash}"

if "${COMPOSE[@]}" exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>/dev/null; then
  ok "Postgres accepting connections"
  CONN_COUNT=$("${COMPOSE[@]}" exec -T db psql -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM pg_stat_activity WHERE datname='$POSTGRES_DB';" 2>/dev/null || echo "?")
  info "Active connections: $CONN_COUNT"
else
  err "Postgres not ready"
fi

# ── Redis ────────────────────────────────────────────────────────
hdr "Redis"

if "${COMPOSE[@]}" exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
  ok "Redis responding to PING"
else
  err "Redis not responding"
fi

# ── BullMQ queue snapshot ────────────────────────────────────────
hdr "BullMQ queues"

QUEUE_INFO=$("${COMPOSE[@]}" exec -T redis redis-cli --raw KEYS "bull:*:meta" 2>/dev/null | head -10 || true)
if [[ -n "$QUEUE_INFO" ]]; then
  echo "$QUEUE_INFO" | sed 's/^/  /'
else
  warn "No BullMQ queues found (may be normal pre-launch)"
fi

# ── Web Push (VAPID) ─────────────────────────────────────────────
hdr "Web Push (VAPID)"

if [[ -z "${VAPID_PUBLIC_KEY:-}" ]]; then
  warn "VAPID_PUBLIC_KEY not set in .env — push notifications disabled"
else
  ok "VAPID keys present in .env"
  CONTAINER_VAPID=$("${COMPOSE[@]}" exec -T api sh -c 'echo -n "$VAPID_PUBLIC_KEY"' 2>/dev/null || true)
  if [[ -n "$CONTAINER_VAPID" ]]; then
    ok "VAPID_PUBLIC_KEY injected into api container"
  else
    err "VAPID_PUBLIC_KEY missing from api container env — restart with: infra/scripts/refresh.sh api"
  fi
fi

# ── Disk usage ───────────────────────────────────────────────────
hdr "Disk usage"
df -h / | tail -n 1 | awk '{print "  Root  : " $3 " used / " $2 " total (" $5 " full)"}'
if [[ -d data/postgres ]]; then
  echo "  pgdata: $(du -sh data/postgres 2>/dev/null | cut -f1)"
fi
if [[ -d backups ]]; then
  echo "  backups: $(du -sh backups 2>/dev/null | cut -f1)"
fi

# ── Recent logs ──────────────────────────────────────────────────
hdr "Recent api logs (last 30 lines)"
"${COMPOSE[@]}" logs --tail=30 api 2>/dev/null || warn "No api logs"

hdr "Recent traefik logs (last 20 lines)"
"${COMPOSE[@]}" logs --tail=20 traefik 2>/dev/null || warn "No traefik logs"

echo
ok "Status check complete"
