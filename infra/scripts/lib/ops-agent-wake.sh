#!/usr/bin/env bash
# infra/scripts/lib/ops-agent-wake.sh
#
# The deploy wake-up (ops agent design §4 "Deploy", rulings 906-908): deploy.sh and redeploy.sh,
# at their end, start the ops agent's cloud task once with run type `deploy`. The cloud run then
# does the daily round and checks the commit the deploy announced. A deploy that stops half-way
# never gets here (ruling 907); rollback.sh, restore.sh and start.sh do not call it (906).
#
# The same call as the worker's alert wake-up (apps/api/src/workers/ops-agent-wake.ts): POST to
# OPS_AGENT_WAKE_URL with the four headers, 15 s, never a retry (the endpoint has no idempotency
# key: a retry is a second run), the certificate always checked (ruling 905).
#
# The token and the URL go to curl on stdin, never as arguments: every user of the host reads a
# process's arguments (ruling 425). `printf` is a builtin: the pipe's forked subshell runs it with
# the parent bash's own argv, so no new argv carries them. `-q` must come first: curl then skips
# ~/.curlrc, which could turn the certificate check off. `--globoff`: a `[1-2]` or `{a,b}` in the
# URL would otherwise be several POSTs, so several runs. `bash -x` would still print the token in
# the printf trace, as it prints the whole of .env when deploy.sh sources it.
#
# It never fails its caller, under `set -Eeuo pipefail` too: deploy.sh prints the box of newly
# generated credentials after this call, and nowhere else.
#
# Requires: lib/log.sh sourced, .env sourced (OPS_AGENT_WAKE_URL, OPS_AGENT_WAKE_TOKEN; an older
# .env has them unset).

# mc_wake_ops_agent_after_deploy <deploy|redeploy> <commit> [service…]
mc_wake_ops_agent_after_deploy() {
  local kind="$1" commit="$2"
  shift 2
  local url="${OPS_AGENT_WAKE_URL:-}" token="${OPS_AGENT_WAKE_TOKEN:-}"

  if [[ -z "$url" && -z "$token" ]]; then
    info "agent: deploy wake-up not configured"
    return 0
  fi
  # Shapes that need no quoting inside curl's config; an http:// URL is refused, as the worker
  # refuses it (verified-fetch.ts).
  if [[ ! "$url" =~ ^https://[^\"\\[:space:]]+$ || ! "$token" =~ ^[A-Za-z0-9._~+/=-]+$ ]]; then
    warn "agent: deploy wake-up misconfigured (one of its two keys is missing or malformed); not called"
    return 0
  fi

  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || commit=unknown
  local text="deploy commit=${commit} kind=${kind}" services="" service
  for service in "$@"; do
    if [[ "$service" =~ ^[a-z][a-z-]*$ ]]; then
      services="${services:+$services,}$service"
    fi
  done
  if [[ -n "$services" ]]; then
    text="$text services=$services"
  fi

  local code rc=0
  code=$(
    printf '%s\n' \
      "url = \"$url\"" \
      "header = \"Authorization: Bearer $token\"" \
      'header = "anthropic-version: 2023-06-01"' \
      'header = "anthropic-beta: experimental-cc-routine-2026-04-01"' \
      'header = "Content-Type: application/json"' |
      curl -q --config - --proto =https --globoff --silent --max-time 15 --output /dev/null \
        --write-out '%{http_code}' --request POST --data-raw "{\"text\":\"$text\"}" 2>/dev/null
  ) || rc=$?

  if [[ "$rc" -ne 0 ]]; then
    warn "agent: the deploy wake-up failed (curl exit $rc); no deploy check this time"
  elif [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
    ok "agent: deploy check started ($code)"
  else
    warn "agent: the deploy wake-up answered ${code:-nothing}; no deploy check this time"
  fi
  return 0
}
