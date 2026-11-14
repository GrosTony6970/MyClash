#!/usr/bin/env bash
# infra/scripts/lib/db-running.sh
#
# ONE owner for "is the database container running?". Sourced by backup.sh and deploy.sh.
#
# `docker compose ps` can itself fail: the daemon is unreachable, the socket refuses us. Read
# as `ps … 2>/dev/null | grep -q db`, that failure looked like a stopped database: the nightly
# backup said "DB container not running", and deploy.sh took it for a first deploy and went on
# with no backup. (Measured on compose v5.6.1: a missing `${X:?}` key does NOT fail `ps`; an
# unreachable daemon does.)
#
# The capture sits in an `if`, so `set -e` lets the caller report it. Output is one service per
# line; a compose warning line can never be exactly "db". No pipe into `grep -q`: its early
# exit can fail the pipeline under pipefail and turn a running database into a stopped one.
#
# Requires: the caller's COMPOSE=(docker compose …) array.

# mc_db_state — sets MC_DB_STATE to running | stopped | unknown, and, when unknown,
# MC_DB_PS_REASON to the last line compose printed.
# shellcheck disable=SC2034  # both are read by the caller, not here
mc_db_state() {
  local out
  MC_DB_PS_REASON=''
  if ! out=$("${COMPOSE[@]}" ps --status running --services 2>&1); then
    MC_DB_STATE=unknown
    MC_DB_PS_REASON=${out##*$'\n'}
    MC_DB_PS_REASON=${MC_DB_PS_REASON:-no output}
  elif [[ $'\n'"$out"$'\n' == *$'\n'db$'\n'* ]]; then
    MC_DB_STATE=running
  else
    MC_DB_STATE=stopped
  fi
}
