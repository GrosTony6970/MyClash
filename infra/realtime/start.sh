#!/bin/bash
# Starts supabase/realtime and writes its one tenant (rulings 424, 505, 506).
#
# Realtime's management API (/api/tenants) takes any token signed with API_JWT_SECRET and never
# reads its role. That secret is Realtime's own (SUPABASE_REALTIME_API_SECRET), never the one that
# signs the public anon key. The image's self-host seed (SEED_SELF_HOST) would re-create the tenant
# with API_JWT_SECRET as its socket secret, so it is off, and this script writes the tenant instead,
# on every start of the container: deploy, start.sh, restore.sh, the ops console, a crash restart.
# Writing it every time also repairs a tenant restored from a backup made under another
# DB_ENC_KEY or SUPABASE_JWT_SECRET (its secrets are stored encrypted with DB_ENC_KEY).
#
# Written for supabase/realtime:v2.124.1. It starts the image's own entrypoint script
# (/app/run.sh, which runs the migrations and then execs the server) and sends the body the
# image's priv/repo/seeds.exs writes, with one change: jwt_secret is the socket secret
# (MYCLASH_REALTIME_SOCKET_SECRET = SUPABASE_JWT_SECRET), not API_JWT_SECRET. infra:review pins the
# image tag next to this file: re-check both against a new image before bumping it.
#
# Keep: no xtrace (it would print the token and the body with the database password into the
# container log), and no secret on a command line. The token is minted in memory from the secret
# (`realtime eval` reads it from the environment) and carries no `exp`: the API checks `exp` only
# when present. It reaches curl through a config on a pipe (-K), the body goes on stdin, and jq
# reads every value from the environment.
set -euo pipefail
: "${API_JWT_SECRET:?}" "${MYCLASH_REALTIME_SOCKET_SECRET:?}" "${SELF_HOST_TENANT_NAME:?}"
: "${DB_HOST:?}" "${DB_PORT:?}" "${DB_NAME:?}" "${DB_USER:?}" "${DB_PASSWORD:?}"

log() { echo "myclash-realtime-start: $1" >&2; }

/app/run.sh "$@" &
server=$!
forward() {
  kill -TERM "$server" 2>/dev/null || true
  wait "$server"
  exit $?
}
trap forward TERM INT

stop() {
  log "$1"
  kill -TERM "$server" 2>/dev/null || true
  wait "$server" 2>/dev/null || true
  exit 1
}

base="http://127.0.0.1:${PORT:-4000}"

# Wait until the server answers at all; the PUT's own code is the verdict.
code=000
while ((SECONDS < 120)); do
  kill -0 "$server" 2>/dev/null || { wait "$server"; exit $?; }
  code=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "$base/api/ping") || code=000
  [[ "$code" == 000 ]] || break
  sleep 1
done
[[ "$code" != 000 ]] || stop "Realtime did not answer on $base within 120 s"

token=$(/app/bin/realtime eval '
  b = fn x -> Base.url_encode64(x, padding: false) end
  d = b.(~s({"alg":"HS256","typ":"JWT"})) <> "." <> b.(~s({"role":"realtime_api","iss":"myclash"}))
  IO.write(d <> "." <> b.(:crypto.mac(:hmac, :sha256, System.fetch_env!("API_JWT_SECRET"), d)))
') || stop "minting the management token failed"
[[ "$token" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] || stop "the mint printed no token"

body=$(jq -n '{tenant: {
  name: env.SELF_HOST_TENANT_NAME,
  external_id: env.SELF_HOST_TENANT_NAME,
  jwt_secret: env.MYCLASH_REALTIME_SOCKET_SECRET,
  extensions: [{type: "postgres_cdc_rls", settings: {
    db_name: env.DB_NAME, db_host: env.DB_HOST, db_user: env.DB_USER,
    db_password: env.DB_PASSWORD, db_port: env.DB_PORT, region: "us-east-1",
    poll_interval_ms: 100, poll_max_record_bytes: 1048576, ssl_enforced: false}}]}}')
# A few tries before giving up (a slow host may still be starting); then the container exits and
# Docker starts it again. A refusal (403) is not retried: no restart can fix the secret.
for attempt in 1 2 3 4 5; do
  code=$(curl -s -o /dev/null --max-time 15 -w '%{http_code}' -X PUT \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$token") \
    -H 'content-type: application/json' --data-binary @- \
    "$base/api/tenants/$SELF_HOST_TENANT_NAME" <<<"$body") || code=000
  [[ "$code" == 200 || "$code" == 201 || "$code" == 403 ]] && break
  log "writing tenant $SELF_HOST_TENANT_NAME answered $code (try $attempt of 5)"
  sleep 3
done
case "$code" in
  200 | 201) log "tenant $SELF_HOST_TENANT_NAME written ($code)" ;;
  403) stop "the management API refused the minted token (403): is API_JWT_SECRET what Realtime reads?" ;;
  *) stop "writing tenant $SELF_HOST_TENANT_NAME answered $code" ;;
esac

wait "$server"
