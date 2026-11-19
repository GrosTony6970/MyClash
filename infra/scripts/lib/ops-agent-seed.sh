#!/usr/bin/env bash
# infra/scripts/lib/ops-agent-seed.sh
#
# ONE owner for seeding the ops agent's key from .env (docs/superpowers/specs/2026-11-18-ops-agent-
# design.md, section 1). Sourced by deploy.sh, restore.sh and rollback.sh (ruling 885): a restore or
# a rollback puts back a database whose key rows date from the backup, so a key revoked on the
# console since then is live again until the seed runs. The seed revokes every key whose hash is not
# OPS_AGENT_KEY's (every key when it is empty) before it calls the login service.
#
# Requires: lib/log.sh sourced, COMPOSE set (lib/compose.sh), .env sourced (DOMAIN, OPS_AGENT_KEY,
# POSTGRES_PASSWORD). The key goes in by name only (ruling 425); the seed prints its state, never
# the key. No function here ever fails its caller.

MC_OPS_AGENT_SEED_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# _mc_run_ops_agent_seed [run flags…] — runs the seed once; sets OPS_AGENT_RESULT (its JSON line, or
# empty), OPS_AGENT_STATE and OPS_AGENT_REVOKED (the count, or empty when unreadable).
_mc_run_ops_agent_seed() {
  # In a subshell: lib/database-url.sh exits on a missing POSTGRES_PASSWORD (`:?`), and that exit
  # must end this read only, never the restore or the deploy that called it.
  OPS_AGENT_RESULT=$(
    # shellcheck source=/dev/null
    source "$MC_OPS_AGENT_SEED_LIB_DIR/database-url.sh" &&
      "${COMPOSE[@]}" \
        run --rm "$@" \
        -e SUPABASE_URL="http://supabase-auth:9999" \
        -e DATABASE_URL \
        -e DOMAIN \
        -e OPS_AGENT_KEY \
        api node /app/scripts/bootstrap-ops-agent.mjs
  ) || true
  OPS_AGENT_STATE=$(node -e "try{console.log(JSON.parse(process.argv[1]).state||'unknown')}catch{console.log('unknown')}" "$OPS_AGENT_RESULT" 2>/dev/null || echo unknown)
  OPS_AGENT_REVOKED=$(node -e "try{const n=JSON.parse(process.argv[1]).revokedOthers;console.log(Number.isInteger(n)?n:'')}catch{console.log('')}" "$OPS_AGENT_RESULT" 2>/dev/null || true)
}

# mc_seed_ops_agent — seeds, then prints the state. Sets OPS_AGENT_STATE.
mc_seed_ops_agent() {
  hdr "Ops agent key"
  _mc_run_ops_agent_seed
  local error
  error=$(node -e "try{console.log(JSON.parse(process.argv[1]).error||'')}catch{console.log('')}" "$OPS_AGENT_RESULT" 2>/dev/null || true)
  case "$OPS_AGENT_STATE" in
    not-configured) ok "agent: not configured (OPS_AGENT_KEY is empty; every agent key is revoked)" ;;
    created) ok "agent: key active (created)" ;;
    existing) ok "agent: key active" ;;
    revoked) warn "agent: key revoked — set a new OPS_AGENT_KEY in .env" ;;
    *) warn "agent: the key seed reported an issue: ${error:-no result}" ;;
  esac
  return 0
}

# mc_revoke_stale_ops_agent_keys — right after a database came back from a backup, while every
# service that reads the keys is still stopped: the seed's first step revokes every key .env does
# not hold, so no path out of the restore (a storage failure included) serves one. --no-deps:
# nothing else may start mid-restore. The login service is stopped, so the account step fails here
# and waits for mc_reseed_ops_agent_after_restore.
mc_revoke_stale_ops_agent_keys() {
  hdr "Ops agent keys (before the restart)"
  _mc_run_ops_agent_seed --no-deps
  if [[ -n "$OPS_AGENT_REVOKED" ]]; then
    ok "agent: ${OPS_AGENT_REVOKED} key(s) that OPS_AGENT_KEY does not hold revoked"
  else
    err "agent: the keys could not be checked before the restart: a key revoked on the console may be live again. Revoke it again on the console, or run deploy.sh."
  fi
  return 0
}

# mc_reseed_ops_agent_after_restore — the whole seed once the stack is back.
mc_reseed_ops_agent_after_restore() {
  mc_seed_ops_agent
  warn "agent: a key revoked on the console after this backup was taken is live again if OPS_AGENT_KEY still holds it. To turn the agent off for good, empty OPS_AGENT_KEY in .env and run deploy.sh."
  case "$OPS_AGENT_STATE" in
    not-configured | created | existing | revoked) ;;
    failed)
      if [[ -n "$OPS_AGENT_REVOKED" ]]; then
        # The revoke ran (it comes before any call to the login service,
        # scripts/bootstrap-ops-agent.mjs): only the account step failed.
        warn "agent: the login service may still be starting after the restart; the next deploy.sh seeds the key again."
      else
        # The revoke never ran (the database could not be reached): say so, never "revoked".
        err "agent: the key seed did not finish (state failed, no key revoked): a key revoked on the console may be live again. Revoke it again on the console, or run deploy.sh."
      fi
      ;;
    *)
      err "agent: the key seed did not finish (state ${OPS_AGENT_STATE}): a key revoked on the console may be live again. Revoke it again on the console, or run deploy.sh."
      ;;
  esac
  return 0
}
