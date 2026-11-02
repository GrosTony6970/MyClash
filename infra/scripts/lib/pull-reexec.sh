#!/usr/bin/env bash
# infra/scripts/lib/pull-reexec.sh
#
# ONE owner for "update the checkout, then run the NEW script" (ruling 400). Sourced by
# deploy.sh and redeploy.sh.
#
# bash keeps reading the script file it started with. After `git reset --hard` puts a new
# deploy.sh on disk, the run in memory is still the OLD code: its .env repair does not know a
# key the new compose file requires, and its compose commands meet a compose file they were
# not written for. So an entrypoint takes the deploy lock, pulls, and then re-executes itself
# from disk; the re-run sees MC_PULLED_FROM and skips the pull.
#
# The deploy lock is fd 9. It survives `exec`, and an `exec` does not run the EXIT trap, so
# the lock is held from the first run into the re-run without a gap. The re-run must NOT
# reopen fd 9: `exec 9>` would close the inherited open file and drop the flock for a moment,
# letting a redeploy.sh or rollback.sh in after the checkout has already moved.
#
# Requires: log.sh sourced, cwd = the repo root.

# mc_lock_deploy <lock file> <message when another run holds it>
mc_lock_deploy() {
  local lock_file="$1" busy="$2"
  if [[ -n "${MC_PULLED_FROM:-}" ]]; then
    if [[ ! -e "/proc/$$/fd/9" ]]; then
      err "The re-run after the pull did not inherit the deploy lock (fd 9 is closed)."
      exit 1
    fi
  else
    exec 9>"$lock_file"
  fi
  # On the inherited fd this re-takes the lock the first run already holds: it cannot fail.
  if ! flock -n 9; then
    err "$busy Lock: $lock_file"
    exit 1
  fi
}

# mc_pull_then_reexec <absolute script path> [original arguments...]
#
# First run: fetch, and when origin/main moved, `reset --hard` to it and exec the script
# again with its original arguments. Nothing after this call runs in the first run then.
# Re-run, or no new commit: returns with PRE_PULL_COMMIT (HEAD before the pull) and
# PULLED_COMMIT (HEAD now) set.
mc_pull_then_reexec() {
  local script="$1"
  shift
  if [[ -n "${MC_PULLED_FROM:-}" ]]; then
    PRE_PULL_COMMIT="$MC_PULLED_FROM"
    PULLED_COMMIT="$(git rev-parse HEAD)"
    unset MC_PULLED_FROM
    ok "Running the new checkout ${PULLED_COMMIT:0:8} (was ${PRE_PULL_COMMIT:0:8})"
    return 0
  fi

  PRE_PULL_COMMIT="$(git rev-parse HEAD)"
  info "Current commit: ${PRE_PULL_COMMIT:0:8}"
  git fetch origin main
  PULLED_COMMIT="$(git rev-parse origin/main)"
  info "Target  commit: ${PULLED_COMMIT:0:8}"
  if [[ "$PRE_PULL_COMMIT" == "$PULLED_COMMIT" ]]; then
    # The file on disk is the one running (a hand pull before the run lands here too).
    warn "No new commits — running the current checkout"
    return 0
  fi

  git reset --hard origin/main
  if [[ ! -f "$script" ]]; then
    err "The new checkout has no $script to re-run. To go back: git reset --hard $PRE_PULL_COMMIT"
    exit 1
  fi
  ok "Code updated — re-running $(basename "$script") from the new checkout"
  MC_PULLED_FROM="$PRE_PULL_COMMIT" exec bash "$script" "$@"
}
