#!/usr/bin/env bash
# infra/scripts/status.sh — comprehensive status check
# Modeled on MyFAL status.sh; extended for MyClash's multi-service stack.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

[[ -f .env ]] || { err "Missing .env"; exit 1; }

COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)

# ── Containers ───────────────────────────────────────────────────
hdr "Docker Compose"
"${COMPOSE[@]}" ps || true

# ── Container health per service ─────────────────────────────────
hdr "Container health"

HEALTH_SERVICES=(
  api
  worker
  web-public
  web-scoring
  web-admin
  web-marketing
  db
  redis
  traefik
  ops-runner
  supabase-auth
  supabase-realtime
  supabase-rest
  supabase-storage
)

print_health_details() {
  local svc="$1"
  local id="$2"

  if [[ "$svc" == "supabase-rest" ]]; then
    local healthcheck
    healthcheck=$(docker inspect --format='{{json .Config.Healthcheck.Test}}' "$id" 2>/dev/null || echo "unknown")
    info "supabase-rest effective healthcheck: $healthcheck"
  fi

  local log
  log=$(docker inspect --format='{{json .State.Health.Log}}' "$id" 2>/dev/null || true)
  if [[ -n "$log" && "$log" != "null" ]]; then
    info "$svc recent healthcheck log: $log"
  fi
}

for svc in "${HEALTH_SERVICES[@]}"; do
  ID=$("${COMPOSE[@]}" ps -q "$svc" 2>/dev/null || true)
  if [[ -z "$ID" ]]; then
    warn "$svc: not running"
    continue
  fi
  HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$ID" 2>/dev/null || echo "unknown")
  case "$HEALTH" in
    healthy)   ok   "$svc: healthy" ;;
    running)
      ok   "$svc: running (no healthcheck)"
      [[ "$svc" == "supabase-rest" ]] && print_health_details "$svc" "$ID"
      ;;
    unhealthy)
      err  "$svc: unhealthy"
      print_health_details "$svc" "$ID"
      ;;
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

if "${COMPOSE[@]}" exec -T api node -e 'const http=require("node:http");const req=http.get("http://127.0.0.1:4000/health",res=>{let body="";res.setEncoding("utf8");res.on("data",chunk=>body+=chunk);res.on("end",()=>{process.stdout.write(body);process.exit(res.statusCode===200?0:1);});});req.setTimeout(3000,()=>req.destroy(new Error("timeout")));req.on("error",err=>{console.error(err.message);process.exit(1);});' 2>/dev/null; then
  echo
  ok "API /health reachable inside container"
else
  warn "API /health not reachable inside container"
fi

# ── API version metadata ─────────────────────────────────────────
hdr "API version"

API_VERSION=$("${COMPOSE[@]}" exec -T api node -e 'const fs=require("node:fs");const path="/app/data/system-versions.json";const fallback={app:{version:"unknown"},containers:{api:{version:"unknown",commit:process.env.GIT_COMMIT||"unknown"}}};const manifest=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,"utf8")):fallback;const appVersion=manifest.app?.version||"unknown";const apiVersion=manifest.containers?.api?.version||"unknown";const commit=manifest.containers?.api?.commit||process.env.GIT_COMMIT||"unknown";console.log(`  App:    ${appVersion}`);console.log(`  API:    ${apiVersion}`);console.log(`  Commit: ${commit}`);' 2>/dev/null || true)
if [[ -n "$API_VERSION" ]]; then
  echo "$API_VERSION"
  ok "API version metadata readable inside container"
else
  warn "API version metadata not readable inside container"
fi

# ── DB health ────────────────────────────────────────────────────
hdr "Postgres"

set -a; source ./.env; set +a
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=myclash}"

if "${COMPOSE[@]}" exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>/dev/null; then
  ok "Postgres accepting connections"
  CONN_COUNT=$(
    "${COMPOSE[@]}" exec -T \
      -e PGPASSWORD="$POSTGRES_PASSWORD" \
      -e PGCONNECT_TIMEOUT=5 \
      -e PGOPTIONS='-c statement_timeout=5000' \
      db psql -w -h 127.0.0.1 -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -c 'SELECT count(*) FROM pg_stat_activity WHERE datname = current_database();' \
      2>/dev/null || echo "?"
  )
  [[ -n "$CONN_COUNT" ]] || CONN_COUNT="?"
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
