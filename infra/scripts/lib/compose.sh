#!/usr/bin/env bash
# infra/scripts/lib/compose.sh
#
# The ONE way an ops script builds its `docker compose` command (scripts/compose-lib.test.mjs
# holds every script to it).
#
# The certificate mode is a setting of the stack, read from `.env`:
#   TLS_CERTS=staging     Let's Encrypt STAGING certificates: the staging-certs overlay (the API
#                         and worker trust the staging chain they read the database through) and
#                         Traefik's staging CA and storage file.
#   TLS_CERTS=production  the plain compose file and Let's Encrypt's production CA.
#
# Before this file, only deploy.sh and redeploy.sh knew the mode, and only from `--dev-certs`
# given on that run. A `redeploy.sh api worker --no-build` without the flag (2026-11-18)
# recreated the API without the overlay: it refused the staging certificate and every database
# read failed. start.sh, rollback.sh and restore.sh could not take the flag at all.
#
# `--dev-certs` still works: it means staging, and when `.env` names no mode yet it writes
# TLS_CERTS=staging there, so the next script needs no flag. Against TLS_CERTS=production it is
# refused rather than obeyed.
#
# Requires: ROOT_DIR, and log.sh (ok, warn, err) sourced. Optional: USE_DEV_CERTS=1.
# Sets: COMPOSE (array), MC_TLS_CERTS (staging | production | empty when unknown).
# Exports: MYCLASH_ROOT_DIR (= ROOT_DIR, the repo's host path; the compose file requires it), and
# GIT_COMMIT (the commit the containers run) when the caller has none.

# shellcheck source=system-versions.sh
source "$(dirname "${BASH_SOURCE[0]}")/system-versions.sh"

# The GIT_COMMIT the api container carries, running or stopped; empty when there is none. The
# template lets only that one value out of Docker, never the container's other variables.
_mc_carried_commit() {
  docker inspect --format '{{range .Config.Env}}{{$kv := split . "="}}{{if eq (index $kv 0) "GIT_COMMIT"}}{{index $kv 1}}{{end}}{{end}}' myclash-api 2>/dev/null || true
}

# Every app container takes `GIT_COMMIT: ${GIT_COMMIT:-unknown}` from this shell, and the scoring
# pad's offline cache follows it. deploy.sh, redeploy.sh and rollback.sh export their own commit
# later. Any other script that creates a container (start.sh, a restore) keeps the commit the
# containers carry, else the apps say "unknown" and every tablet keeps its old cache in silence
# (2026-11-20). The deploy manifest comes second: deploy.sh writes it before it builds, so after
# a failed deploy it names a commit no container runs.
_mc_export_deployed_commit() {
  [[ -n "${GIT_COMMIT:-}" ]] && return 0
  local commit
  commit="$(_mc_carried_commit)"
  if [[ -z "$commit" || "$commit" == unknown ]]; then
    commit="$(cd "$ROOT_DIR" && mc_manifest_deployed_commit)"
  fi
  [[ -n "$commit" && "$commit" != unknown ]] && export GIT_COMMIT="$commit"
  return 0
}

_mc_read_tls_certs() {
  [[ -f "$ROOT_DIR/.env" ]] || return 0
  sed -n 's/^TLS_CERTS=//p' "$ROOT_DIR/.env" | tail -n 1 | tr -d '"'\''[:space:]'
}

_mc_write_tls_certs() {
  local env_file="$ROOT_DIR/.env"
  if grep -q '^TLS_CERTS=' "$env_file" 2>/dev/null; then
    sed -i 's/^TLS_CERTS=.*/TLS_CERTS=staging/' "$env_file"
  else
    printf 'TLS_CERTS=staging\n' >>"$env_file"
  fi
}

mc_compose_init() {
  local mode
  mode="$(_mc_read_tls_certs)"

  if [[ "${USE_DEV_CERTS:-0}" -eq 1 ]]; then
    if [[ "$mode" == production ]]; then
      err "--dev-certs given, but .env says TLS_CERTS=production. Change .env if the stack really moves back to staging certificates."
      exit 1
    fi
    if [[ "$mode" != staging ]]; then
      _mc_write_tls_certs
      ok "Recorded TLS_CERTS=staging in .env: later scripts need no --dev-certs."
    fi
    mode=staging
  fi

  COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)
  # The compose file mounts the repo into the ops runner at this path, and Compose reads it from
  # this shell. Compose run inside the runner hands its bind paths to the host's Docker daemon, so
  # the runner must see the repo where the host does. Never in .env: a later load would empty it.
  export MYCLASH_ROOT_DIR="$ROOT_DIR"
  _mc_export_deployed_commit
  case "$mode" in
    staging)
      COMPOSE+=(-f infra/docker-compose.staging-certs.yml)
      export ACME_STORAGE_FILE=acme-staging.json
      export ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory
      MC_TLS_CERTS=staging
      ;;
    production)
      MC_TLS_CERTS=production
      ;;
    *)
      MC_TLS_CERTS=""
      warn "TLS_CERTS is not staging or production in .env: this script uses the plain compose file."
      ;;
  esac
}

# For a script that creates or recreates containers: with no known mode it would pick the
# certificates for the whole stack by accident, so it stops instead.
mc_require_cert_mode() {
  if [[ -z "${MC_TLS_CERTS:-}" ]]; then
    err "Set the certificate mode in .env first: TLS_CERTS=staging (Let's Encrypt staging certificates) or TLS_CERTS=production."
    exit 1
  fi
}
