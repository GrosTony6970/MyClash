#!/usr/bin/env bash
# CI, Deploy migration run (rulings 778-781): the API, started from the production image through
# the prod compose file on .env.example, beside the database and Redis the steps above started.
# Every unit test was green the day Nest 12.5 stopped the API from starting; only a real start
# shows what a real start does.
#
# Phase 1, a healthy start:
#   - /health answers 200, an anonymous admin read is refused (401/403), an unknown route is a
#     404 (asked from inside the container: the api service publishes no port);
#   - scripts/check-api-boot.mjs reads its log: "Nest application successfully started", no
#     warning or error before it, and the routes it mapped = the API client's operations.
# Phase 2, a broken start ends the process (ruling 781): with a malformed AI_KEY_SECRET the start
# fails in a start-up hook, and the process must exit with code 1 within the bound, having logged
# the failure. A one-off `run` container has no restart policy, so its exit code is the
# process's; the service's `restart: unless-stopped` would start it again and hide the exit.
# Phase 3, the jobs run in the worker alone (rulings 807-809): phase 1 also reads Redis's client
# list while the api runs alone (no queue consumer); then the worker service, from its own
# command in the compose file, runs alone: /health 200 and the API's /api/v1/version 404 from
# inside it, one consumer of each queue an @Processor names, its start and auto-lock lines with
# no warning before them (scripts/check-api-boot.mjs --worker).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

set -a
# shellcheck source=/dev/null
source .env.example
set +a
# The AI keys are encrypted with a 64-hex-character key; .env.example leaves it empty
# (ensure-prod-env generates prod's). The shell's value wins over --env-file, and an exported
# variable keeps it off every command line.
AI_KEY_SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
export AI_KEY_SECRET
compose=(docker compose --env-file .env.example -f infra/docker-compose.prod.yml)
log="${RUNNER_TEMP:-/tmp}/api-boot.log"
failed=0
red() {
  echo "RED $*"
  failed=1
}
ok() { echo "ok  $*"; }

# The status a container answers for a path, asked from inside it; 000 when none.
status_in() {
  docker exec "$1" node -e "fetch('http://127.0.0.1:4000$2').then((r) => process.stdout.write(String(r.status)), () => process.stdout.write('000'))" 2>/dev/null || echo 000
}
status() { status_in myclash-api "$1"; }

# Redis's client list, where each BullMQ consumer is a named connection. A failed read is red.
clients() {
  docker exec myclash-redis redis-cli CLIENT LIST >"$1" 2>&1 || {
    cat "$1"
    red "Redis's client list could not be read"
  }
}

# A red step above (the database or Redis not healthy) can stop compose itself: said, and the
# checks below still run and print what they see.
"${compose[@]}" up -d api || red "compose could not start the api service"

# A healthy start takes a few seconds; the start bound inside the API is 60 s.
SECONDS=0
health=000
while ((SECONDS < 90)); do
  health=$(status /health)
  [[ "$health" == 200 ]] && break
  # The service restarts a process that exits: a restart means the start failed.
  restarts=$(docker inspect -f '{{.RestartCount}}' myclash-api 2>/dev/null || echo 0)
  ((restarts > 0)) && break
  sleep 2
done
if [[ "$health" == 200 ]]; then
  ok "/health 200 after ${SECONDS} s"
else
  red "/health answered $health after ${SECONDS} s; the container restarted ${restarts:-0} time(s)"
fi

admin=$(status /api/v1/admin/audit-log)
if [[ "$admin" == 401 || "$admin" == 403 ]]; then ok "anonymous admin read $admin"; else red "anonymous admin read $admin, not 401/403"; fi
unknown=$(status /api/v1/probe-marker-missing)
if [[ "$unknown" == 404 ]]; then ok "unknown route 404"; else red "unknown route $unknown, not 404"; fi

docker logs myclash-api >"$log" 2>&1 || true
node scripts/check-api-boot.mjs "$log" packages/api-client/src/generated/schema.ts || failed=1
if ((failed)); then tail -n 40 "$log"; fi
# A consumer names its connection once it connects, after the start: give a wrong build the time
# to show one.
sleep 5
api_clients="${RUNNER_TEMP:-/tmp}/api-clients.txt"
clients "$api_clients"
node scripts/check-api-boot.mjs --api-consumers "$api_clients" || failed=1
"${compose[@]}" stop api >/dev/null || true

# Phase 2. On a build that does not end a failed start the process stays up, and `timeout` ends
# the wait with 124.
broken="${RUNNER_TEMP:-/tmp}/api-broken.log"
set +e
AI_KEY_SECRET=not-a-hex-key timeout 90 "${compose[@]}" run --rm --no-deps -T --name myclash-api-broken api >"$broken" 2>&1
code=$?
set -e
docker rm -f myclash-api-broken >/dev/null 2>&1 || true
if [[ "$code" == 1 ]] && grep -q 'The API did not start:' "$broken" && ! grep -q 'Nest application successfully started' "$broken"; then
  ok "a broken start exits 1, its failure logged"
else
  tail -n 30 "$broken"
  red "a broken start ended with code $code (expected 1, its failure logged, no start)"
fi

# Phase 3. The worker service as compose declares it (its command, `--worker`), alone: the api
# is stopped and the broken start has ended.
worker=myclash-worker-probe
worker_log="${RUNNER_TEMP:-/tmp}/worker-boot.log"
worker_clients="${RUNNER_TEMP:-/tmp}/worker-clients.txt"
"${compose[@]}" run -d --no-deps --name "$worker" worker >/dev/null || red "compose could not start the worker"
SECONDS=0
health=000
while ((SECONDS < 90)); do
  health=$(status_in "$worker" /health)
  [[ "$health" == 200 ]] && break
  sleep 2
done
if [[ "$health" == 200 ]]; then ok "worker /health 200 after ${SECONDS} s"; else red "worker /health answered $health after ${SECONDS} s"; fi
api_route=$(status_in "$worker" /api/v1/version)
if [[ "$api_route" == 404 ]]; then ok "the worker serves no API route (/api/v1/version 404)"; else red "the worker answered /api/v1/version with $api_route, not 404"; fi
# Its consumers connect after /health listens: read until the check passes, 30 s at most, then
# once more with its findings printed.
for _ in $(seq 1 15); do
  docker logs "$worker" >"$worker_log" 2>&1 || true
  clients "$worker_clients"
  node scripts/check-api-boot.mjs --worker "$worker_log" "$worker_clients" >/dev/null 2>&1 && break
  sleep 2
done
docker logs "$worker" >"$worker_log" 2>&1 || true
clients "$worker_clients"
if ! node scripts/check-api-boot.mjs --worker "$worker_log" "$worker_clients"; then
  failed=1
  tail -n 40 "$worker_log"
fi
docker rm -f "$worker" >/dev/null 2>&1 || true

if ((failed)); then
  echo "API START: fail"
  exit 1
fi
echo "API START: ok"
