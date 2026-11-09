#!/usr/bin/env bash
# CI, Deploy migration run (rulings 424, 504-507): Realtime, started from the prod compose file
# on .env.example after the deploy's migrations, writes its own tenant, and a browser socket
# receives a database change through it. The proof that infra/realtime/start.sh still fits the
# image: a Realtime bump that changes its start, its management API or the tenant body goes red
# here instead of killing every live screen after a deploy that reports success.
#
#   - the container turns healthy (its healthcheck is /api/ping as the tenant: the tenant exists;
#     the image's own seed is off);
#   - the management API refuses the anon and the service key (403): its secret is its own;
#   - an anon socket joins with postgres_changes and receives an INSERT made through PostgREST;
#   - a garbage token is refused at the upgrade (401).
# The socket is opened on a host name whose first label is the tenant (`app.ci`), so the Host
# it sends is the one the edge forwards in prod. The HTTP half is
# scripts/realtime-socket-probe.mjs, run inside the api image like check-service-db-users.mjs.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

set -a
# shellcheck source=/dev/null
source .env.example
set +a
# Realtime encrypts its tenant's secrets with a 16-byte key; .env.example's sample is not one
# (ensure-prod-env generates prod's). The shell's value wins over --env-file.
export SUPABASE_REALTIME_DB_ENC_KEY=ci-realtime-key-
compose=(docker compose --env-file .env.example -f infra/docker-compose.prod.yml)
failed=0
red() {
  echo "RED $*"
  failed=1
}
ok() { echo "ok  $*"; }
sql() { docker exec myclash-db psql -h 127.0.0.1 -U supabase_admin -d "$POSTGRES_DB" -Atc "$1"; }

fail_now() {
  red "$*"
  echo "REALTIME SOCKET: fail"
  exit 1
}

"${compose[@]}" up -d supabase-rest supabase-realtime

# Docker runs the healthcheck every 30 s (start_period included), so the status can only change
# at 30, 60, 90… s: a boot that ends at 31 s turns healthy at 60 s. 180 s leaves room on a slow
# runner (Realtime has one CPU). Counted from here, after `up` (which may pull the image).
SECONDS=0
health=none
while ((SECONDS < 180)); do
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' myclash-supabase-realtime 2>/dev/null || true)
  [[ "$health" == healthy ]] && break
  sleep 2
done
written=$(docker logs myclash-supabase-realtime 2>&1 | grep 'myclash-realtime-start' || true)
if [[ "$health" == healthy ]]; then
  ok "Realtime healthy; ${written:-no start line}"
else
  docker logs --tail 30 myclash-supabase-realtime 2>&1 || true
  fail_now "Realtime is '$health' after ${SECONDS} s; start script said: ${written:-nothing}"
fi

# A table of this run only, in the publication Realtime reads (migration 0004), readable by anon,
# written by the service role through PostgREST. The db image's DDL event trigger already makes
# PostgREST reload its schema cache; the notify asks for it anyway, and the probe retries its
# INSERT until the change arrives.
sql "create table public.ci_realtime_probe (id bigint generated always as identity primary key, v text);
grant select on public.ci_realtime_probe to anon;
grant select, insert on public.ci_realtime_probe to service_role;
alter publication supabase_realtime add table public.ci_realtime_probe;
notify pgrst, 'reload schema';" >/dev/null || fail_now "could not create the probe table (did the migrations run?)"

# The api image, on `myclash`, with `app.ci` naming Realtime's address: `compose run` cannot add
# a host entry, and an alias would mean taking Realtime off the network it reaches the db on.
# Compose names a built service's image <project>-<service>; the job built it in its first step.
api_image="${COMPOSE_PROJECT_NAME}-api"
docker image inspect "$api_image" >/dev/null || fail_now "no image $api_image"
rt_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "myclash").IPAddress}}' myclash-supabase-realtime)
if ! docker run --rm --network myclash --add-host "app.ci:$rt_ip" -v "$PWD/scripts:/check:ro" \
  -e SUPABASE_JWT_SECRET "$api_image" node /check/realtime-socket-probe.mjs; then
  red "the socket checks"
fi

if [[ "$failed" -eq 0 ]]; then
  echo "REALTIME SOCKET: pass"
else
  echo "REALTIME SOCKET: fail"
fi
exit "$failed"
