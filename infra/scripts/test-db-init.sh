#!/usr/bin/env bash
# Verify DB initialises correctly: supabase_admin is superuser, postgres is not.
#
# RED:   run before the POSTGRES_USER fix — db never becomes healthy
# GREEN: run after the fix — both assertions pass
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

DOTENV=".env"
COMPOSE_FILE="infra/docker-compose.prod.yml"

echo "Wiping existing db volume..."
docker compose --env-file "$DOTENV" -f "$COMPOSE_FILE" down db 2>/dev/null || true
docker volume rm myclash-postgres-data 2>/dev/null || true

echo "Starting db..."
docker compose --env-file "$DOTENV" -f "$COMPOSE_FILE" up -d db

echo "Waiting for healthy (max 180s)..."
for i in $(seq 1 60); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' myclash-db 2>/dev/null || echo "missing")
  if [[ "$STATUS" == "healthy" ]]; then
    echo "  db is healthy"
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "FAIL: db never became healthy (status: $STATUS)"
    docker logs --tail=40 myclash-db
    docker compose --env-file "$DOTENV" -f "$COMPOSE_FILE" down db
    exit 1
  fi
  sleep 3
done

echo "Verifying role attributes..."
RESULT=$(docker exec myclash-db psql \
  -U "${POSTGRES_USER:-supabase_admin}" \
  -d "${POSTGRES_DB:-myclash}" \
  -tAc "SELECT usename || ':' || usesuper FROM pg_user WHERE usename IN ('postgres','supabase_admin') ORDER BY usename;")

echo "$RESULT"

SUPA_SUPER=$(echo "$RESULT" | grep "^supabase_admin:" | cut -d: -f2)
PG_SUPER=$(echo "$RESULT"   | grep "^postgres:"       | cut -d: -f2)

[[ "$SUPA_SUPER" == "t" ]] || { echo "FAIL: supabase_admin is not superuser"; docker compose --env-file "$DOTENV" -f "$COMPOSE_FILE" down db; exit 1; }
[[ "$PG_SUPER"   == "f" ]] || { echo "FAIL: postgres is still superuser (bootstrap user not demoted)"; docker compose --env-file "$DOTENV" -f "$COMPOSE_FILE" down db; exit 1; }

echo "PASS: supabase_admin=superuser, postgres=non-superuser"
docker compose --env-file "$DOTENV" -f "$COMPOSE_FILE" down db
