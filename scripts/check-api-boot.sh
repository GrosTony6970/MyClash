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

# The status the API answers for a path, asked from inside its container; 000 when none.
status() {
  docker exec myclash-api node -e "fetch('http://127.0.0.1:4000$1').then((r) => process.stdout.write(String(r.status)), () => process.stdout.write('000'))" 2>/dev/null || echo 000
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

if ((failed)); then
  echo "API START: fail"
  exit 1
fi
echo "API START: ok"
