#!/usr/bin/env bash
# infra/scripts/lib/worker-drain.sh
#
# ONE owner for stopping the worker before a recreate (rulings 811, 814, 815). Sourced by
# deploy.sh and redeploy.sh.
#
# The worker is the only process that runs jobs, and a stop lets the job in flight finish, for up
# to its stop_grace_period (5m, infra/docker-compose.prod.yml; apps/api/src/common/graceful-stop.ts).
# Left inside the scripts' time-bounded `up -d` (120 s, 240 s), that wait is cut short: compose
# was killed while it waited for the old worker, the new one was never started, and the old one,
# still answering /health while it finished, passed the health poll. A redeploy reported success
# and then no job ran anywhere. It also held the new api back: compose starts the containers it
# recreates only once every old one has stopped.
#
# So the worker stops here first, on its own, with a bound past its grace; the bounded `up -d`
# after it then creates and starts the new worker at once. A worker that is not running is a
# no-op. infra:review pins the bound against the compose grace.
#
# Requires: log.sh (ok, warn) and the caller's COMPOSE=(docker compose …) array.

# The worker's grace (300 s) plus slack for compose itself.
MC_WORKER_STOP_TIMEOUT=330

# mc_drain_worker — stop the worker, waiting for its job in flight. Never fails the caller: the
# recreate and the health poll after it decide; a stop that did not end is said.
mc_drain_worker() {
  local rc=0
  timeout --kill-after=10 "$MC_WORKER_STOP_TIMEOUT" "${COMPOSE[@]}" stop worker || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    ok "Worker stopped (its job in flight, if any, finished)"
  else
    warn "Stopping the worker ended with code $rc; the recreate below replaces it anyway"
  fi
}
