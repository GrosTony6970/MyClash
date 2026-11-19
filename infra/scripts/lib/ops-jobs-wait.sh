#!/usr/bin/env bash
# infra/scripts/lib/ops-jobs-wait.sh
#
# ONE owner for "wait for a running ops-runner job" (ops agent slice 4b, ruling 898). Sourced by
# deploy.sh, redeploy.sh and rollback.sh, and called right after they take .deploy.lock, before
# they move the checkout or touch the stack.
#
# The race: a job of the ops runner — a backup, a restore, a container action, a renewal, a disk
# prune — that started before .deploy.lock was taken runs beside the deploy. Each `docker compose`
# call it makes re-reads the bind-mounted compose file, which `git reset --hard` replaces under it
# (new compose file, old .env), and the rebuild recreates the runner itself mid-job. The runner
# refuses a NEW container action or renewal while .deploy.lock is held (ruling 887); this closes
# the one already running.
#
# Only the runner can say whether its lock is held (the lock file names a process; only that
# process knows its job still runs: infra/ops-runner/ops-lock.mjs), so it is asked through
# `docker exec` on its fixed container name: no COMPOSE and no .env needed. A runner that is not
# running holds nothing. One that does not answer, or an old image without GET /ops-lock, is said
# and does not block the deploy.
#
# Requires: log.sh (info, warn, err).

# How long a deploy waits for a job before it gives up, and how often it asks. A worker action
# runs up to 285 s and a backup some minutes.
MC_OPS_WAIT_S="${MC_OPS_WAIT_S:-600}"
MC_OPS_POLL_S="${MC_OPS_POLL_S:-5}"

# mc_wait_for_ops_jobs — return once no ops-runner job holds its lock; exit 1 when one still does
# after MC_OPS_WAIT_S, with nothing changed yet.
mc_wait_for_ops_jobs() {
  local line deadline=$((SECONDS + MC_OPS_WAIT_S)) said=""
  while :; do
    # stdout only: Docker's warnings go to stderr and are never the answer. Its last line is.
    if ! line=$(timeout 30 docker exec myclash-ops-runner node infra/ops-runner/ops-lock-probe.mjs 2>/dev/null); then
      info "No ops-runner job to wait for: the runner is not running."
      return 0
    fi
    line="${line##*$'\n'}"
    case "$line" in
      free)
        return 0
        ;;
      held\ *)
        # shellcheck disable=SC2086 # the probe prints three plain words
        set -- $line
        if [[ -z "$said" ]]; then
          info "Waiting for the ops runner's $2 (since $3) to end..."
          said=1
        fi
        if ((SECONDS >= deadline)); then
          err "The ops runner's $2 still holds its lock after ${MC_OPS_WAIT_S} s. Nothing was changed. Run this again when it has ended."
          exit 1
        fi
        sleep "$MC_OPS_POLL_S"
        ;;
      *)
        warn "Could not ask the ops runner about its jobs (${line:-no answer}); going on."
        return 0
        ;;
    esac
  done
}
