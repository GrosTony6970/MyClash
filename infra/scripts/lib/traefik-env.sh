#!/usr/bin/env bash
# infra/scripts/lib/traefik-env.sh
#
# Computes the Traefik edge variables that docker-compose.prod.yml interpolates
# into the traefik service's labels. Sourced by deploy.sh, redeploy.sh and
# start.sh — every entrypoint that runs `docker compose up`, because Compose
# reads these from the *invoking shell*, not from --env-file.
#
# Miss one caller and the stack silently comes up with an empty ban allowlist
# (or, worse, with plugin middlewares still referenced while disabled).
# check-infra-review.mjs asserts all three source this file.
#
# Requires: ROOT_DIR set by the caller.

# --- Ban allowlist ----------------------------------------------------------
# The API skips throttling for THROTTLE_IP_WHITELIST; the edge must skip banning
# for the same addresses, or the organiser gets banned by the proxy while the app
# happily waves them through. ONE trusted-IP list, derived — never two hand-kept
# copies that drift.
#
# Read from .env explicitly: the scripts pass --env-file to Compose, so the
# invoking shell never sees those variables. Targeted sed rather than sourcing
# the whole file, to avoid dumping every secret into this script's environment.
_mc_throttle_whitelist=""
if [[ -f "$ROOT_DIR/.env" ]]; then
  _mc_throttle_whitelist="$(sed -n 's/^THROTTLE_IP_WHITELIST=//p' "$ROOT_DIR/.env" | tr -d '"'\''' | tr -d '[:space:]')"
fi

# ${var:+,$var} is bash, not Compose: Compose interpolation documents :- and :?
# but not :+, so the join happens here where the syntax is certain. An empty
# whitelist yields the local ranges with no trailing comma.
export TRAEFIK_BAN_ALLOWLIST="127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16${_mc_throttle_whitelist:+,$_mc_throttle_whitelist}"
unset _mc_throttle_whitelist

# --- Plugin middleware kill-switch ------------------------------------------
# Traefik fetches plugin source from GitHub at startup. That fetch is allowed to
# fail without stopping Traefik (AbortOnPluginFailure is left at its default
# false) — but a router referencing a middleware whose plugin didn't load fails
# to build and serves 404. Availability therefore needs a way to DETACH the
# plugin middlewares, not just tolerate the failed download.
#
# TRAEFIK_PLUGINS=off empties these prefixes, so every router chain drops back to
# security-headers/compress and the site serves unprotected but alive:
#
#   TRAEFIK_PLUGINS=off ./infra/scripts/start.sh
#
if [[ "${TRAEFIK_PLUGINS:-on}" == "off" ]]; then
  export MW_GEO_ADMIN="" MW_GEO_PUBLIC="" MW_F2B_AUTH="" MW_F2B_STAFF=""
  warn "TRAEFIK_PLUGINS=off — GeoBlock and Fail2Ban middlewares are DETACHED."
  warn "The edge is serving without country filtering or ban protection."
else
  export MW_GEO_ADMIN="myclash-geoblock-admin@file,"
  export MW_GEO_PUBLIC="myclash-geoblock-public@file,"
  export MW_F2B_AUTH="myclash-fail2ban-auth@docker,"
  export MW_F2B_STAFF="myclash-fail2ban-staff@docker,"
fi

# --- Post-start warning -----------------------------------------------------
# Traefik logs the plugin failure and carries on, so nothing else would tell the
# operator that the edge lost its security middlewares. Call this after
# `docker compose up -d`.
mc_warn_if_plugins_failed() {
  local container="${1:-myclash-traefik}"
  local logs
  logs="$(docker logs --tail 200 "$container" 2>&1 || true)"

  if grep -q "Plugins are disabled because an error has occurred" <<<"$logs"; then
    warn "──────────────────────────────────────────────────────────────"
    warn "Traefik started but its PLUGINS FAILED TO LOAD."
    warn "GeoBlock and Fail2Ban are not active, and every router that"
    warn "references them is serving 404 until this is resolved."
    warn ""
    warn "Restore availability now:"
    warn "  TRAEFIK_PLUGINS=off ./infra/scripts/start.sh"
    warn ""
    warn "Then investigate (usually a transient GitHub/network failure at"
    warn "boot; the download is cached in ./data/traefik/plugins afterwards):"
    warn "  docker logs $container | grep -i plugin"
    warn "──────────────────────────────────────────────────────────────"
    return 1
  fi
  return 0
}
