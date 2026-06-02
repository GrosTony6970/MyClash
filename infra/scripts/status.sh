#!/usr/bin/env bash
# infra/scripts/status.sh — comprehensive status check
# Modeled on MyFAL status.sh; extended for MyClash's multi-service stack.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

# ── Argv ────────────────────────────────────────────────────────
ERRORS_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --errors|-e) ERRORS_ONLY=1 ;;
    --help|-h)
      cat <<'USAGE'
Usage: status.sh [--errors|-e] [--help|-h]

Reports container health, last deploy, API/DB/Redis status, and
recent service logs.

Options:
  --errors, -e   Show only error / warn lines in the recent-logs
                 sections. Default: show full tail with errors
                 highlighted in red.
  --help, -h     Print this help and exit.
USAGE
      exit 0
      ;;
    *)
      err "Unknown argument: $arg"
      err "Run 'status.sh --help' for usage."
      exit 64
      ;;
  esac
done

[[ -f .env ]] || { err "Missing .env"; exit 1; }

COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)

# ── Log viewer helpers ──────────────────────────────────────────
# Drop request-log noise: the verbose Nest middleware lines that
# embed full sentry-trace + baggage headers (each ~3 KB), plus
# Docker healthcheck internal /health pings (already covered by
# the dedicated API /health probe further down).
filter_log_noise() {
  grep -vE '"event":"http_request"|GET /health |"url":"/health"' || true
}

# Highlight problem lines in-place: pino level 40+ JSON entries,
# any line containing 'error/fatal/warn' (case-insensitive). The
# `|$` clause matches end-of-line so non-matching lines pass
# through uncoloured. Falls back to `cat` so the helper never
# drops lines, even on dumb terminals.
highlight_log_errors() {
  GREP_COLOR='1;31' grep --color=always -E \
    '"level":(40|50|60)|[Ee][Rr][Rr][Oo][Rr]|[Ww][Aa][Rr][Nn]|[Ff][Aa][Tt][Aa][Ll]|$' \
    || cat
}

# Errors-only mode: keep only lines that match the same patterns
# as the highlighter. No fallback — empty output IS the signal
# "all green in this service."
errors_only_filter() {
  grep -E \
    '"level":(40|50|60)|[Ee][Rr][Rr][Oo][Rr]|[Ww][Aa][Rr][Nn]|[Ff][Aa][Tt][Aa][Ll]' \
    || true
}

# Emit one log section. Pulls 200 raw lines from the service so
# the post-filter tail still has enough content for busy
# services (each request emits 2 lines once the Nest middleware
# is filtered out). In --errors mode the tail-N cap is skipped:
# we want every matching warn/error in the recent window.
tail_service_log() {
  local svc="$1"
  local tail_lines="$2"
  local title="$3"
  if [[ "$ERRORS_ONLY" == "1" ]]; then
    hdr "$title (errors / warnings only)"
  else
    hdr "$title"
  fi
  local raw
  raw=$("${COMPOSE[@]}" logs --tail=200 "$svc" 2>/dev/null || true)
  if [[ -z "$raw" ]]; then
    warn "No $svc logs"
    return
  fi
  if [[ "$ERRORS_ONLY" == "1" ]]; then
    echo "$raw" | filter_log_noise | errors_only_filter
  else
    echo "$raw" | filter_log_noise | tail -n "$tail_lines" | highlight_log_errors
  fi
}

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

API_VERSION=$("${COMPOSE[@]}" exec -T api node -e 'const fs=require("node:fs");const path="/app/data/system-versions.json";const fallback={app:{version:"unknown"},containers:{api:{version:"unknown",commit:process.env.GIT_COMMIT||"unknown"}}};let manifest=fallback;let source="fallback";let type="missing";try{const stat=fs.statSync(path);type=stat.isFile()?"file":stat.isDirectory()?"directory":"other";if(stat.isFile()){try{manifest=JSON.parse(fs.readFileSync(path,"utf8"));source="manifest";}catch{source="malformed";}}}catch{}const appVersion=manifest.app?.version||"unknown";const apiVersion=manifest.containers?.api?.version||"unknown";const commit=manifest.containers?.api?.commit||process.env.GIT_COMMIT||"unknown";console.log(`  App:    ${appVersion}`);console.log(`  API:    ${apiVersion}`);console.log(`  Commit: ${commit}`);console.log(`  Source: ${source}`);console.log(`  Manifest path type: ${type}`);' 2>/dev/null || true)
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
# Pass --errors / -e to trim every section to error/warn lines only.
tail_service_log api 30 "Recent api logs (last 30 lines, noise-filtered)"
tail_service_log traefik 20 "Recent traefik logs (last 20 lines, noise-filtered)"
tail_service_log worker 20 "Recent worker logs (BullMQ jobs)"
tail_service_log web-admin 15 "Recent web-admin logs"
tail_service_log web-public 15 "Recent web-public logs"
tail_service_log web-scoring 15 "Recent web-scoring logs"
tail_service_log supabase-auth 15 "Recent supabase-auth logs"

echo
ok "Status check complete"
