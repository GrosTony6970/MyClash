#!/usr/bin/env bash
# infra/scripts/deploy.sh
#
# Server-side deploy script. Runs ON THE OVH VPS, invoked by SSH from the
# owner's local machine via the cross-platform wrapper at scripts/deploy.ts.
#
# What it does (in order):
#   1. Validate environment (.env, config files, JSON syntax)
#   2. Acquire deploy lock (flock) — only one deploy at a time
#   3. Sync version stamps (PWA cache busts)
#   4. Generate VAPID keys if missing (web push)
#   5. Pre-deploy DB backup (pg_dump → backups/pre-deploy/)
#   6. git fetch + reset --hard origin/main
#   7. docker compose build
#   8. Run pending migrations (FAILS HERE → deploy aborts, old version still up)
#   9. docker compose up -d
#  10. Wait for healthchecks
#  11. Smoke tests
#  12. Record .last-deploy.json
#
# This script is modeled on the proven MyFAL deploy.sh pattern. The MyFAL
# logging/validation conventions are preserved verbatim.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"

ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

# Wall clock for the whole run — prerequisites, lock, build, migrations, health
# waits. Reported in the final summary and persisted to .last-deploy.json.
DEPLOY_STARTED_AT=$(date +%s)

# Exports TRAEFIK_BAN_ALLOWLIST + the MW_* middleware prefixes that
# docker-compose.prod.yml interpolates. Compose reads these from this shell,
# not from --env-file, so every entrypoint that runs `up` must source it.
source "$SCRIPT_DIR/lib/traefik-env.sh"

# ── Arguments ────────────────────────────────────────────────────
USE_DEV_CERTS=0
SKIP_BACKUP=0
SKIP_MIGRATIONS=0
CREATE_DEMO_ORG=0

# Outcome of the super admin bootstrap step, rendered in the credentials box at
# the very end: created | synced | existing | failed | unknown.
SUPER_ADMIN_STATE=unknown

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev-certs)        USE_DEV_CERTS=1; shift ;;
    --skip-backup)      SKIP_BACKUP=1; shift ;;        # for fast iterating; never in prod
    --skip-migrations)  SKIP_MIGRATIONS=1; shift ;;    # for fast iterating; never in prod
    --create-demo-org)  CREATE_DEMO_ORG=1; shift ;;    # provision the E2E sandbox org from .env.e2e
    -h|--help)
      cat <<EOF
Usage: infra/scripts/deploy.sh [options]

  --dev-certs          Use Let's Encrypt staging certificates.
  --skip-backup        Skip pre-deploy DB backup (DEV ONLY — never use in production).
  --skip-migrations    Skip migration step (DEV ONLY).
  --create-demo-org    After deploy, provision the E2E sandbox org "test ai org"
                       from .env.e2e (E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD/E2E_ORG_SLUG).
                       Idempotent. Requires .env.e2e at the repo root.
  -h, --help           Show this help.

For a fast single-service rebuild without a full deploy, see redeploy.sh.
To (re)provision the demo org without a full deploy, run the seeder directly:
  docker compose --env-file .env -f infra/docker-compose.prod.yml run --rm \\
    -e SUPABASE_URL=http://supabase-auth:9999 \\
    -e SUPABASE_SERVICE_ROLE_KEY="\$SUPABASE_SERVICE_ROLE_KEY" \\
    -e DATABASE_URL="postgres://\$POSTGRES_USER:\$POSTGRES_PASSWORD@db:5432/\$POSTGRES_DB" \\
    -e E2E_ADMIN_EMAIL=... -e E2E_ADMIN_PASSWORD=... -e E2E_ORG_SLUG=... \\
    api node /app/scripts/create-demo-org.mjs
EOF
      exit 0
      ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Prerequisites ────────────────────────────────────────────────
run_privileged() {
  if [[ "$EUID" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

require_privilege() {
  if [[ "$EUID" -ne 0 ]] && ! command -v sudo &>/dev/null; then
    err "Missing sudo and current user is not root. Cannot install prerequisites."
    exit 1
  fi
}

is_debian() {
  [[ -r /etc/os-release ]] || return 1
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == "debian" || " ${ID_LIKE:-} " == *" debian "* ]]
}

install_apt_packages() {
  local packages=("$@")
  [[ "${#packages[@]}" -gt 0 ]] || return 0
  require_privilege
  warn "Missing Debian packages: ${packages[*]}"
  confirm "Install missing packages with apt now?" || { err "Prerequisite install declined"; exit 1; }
  export DEBIAN_FRONTEND=noninteractive
  run_privileged apt-get update -qq
  run_privileged apt-get install -y -qq "${packages[@]}"
}

install_docker_engine() {
  require_privilege
  confirm "Install/repair Docker Engine and Compose plugin from Docker's Debian apt repo?" || {
    err "Docker install declined"
    exit 1
  }

  export DEBIAN_FRONTEND=noninteractive
  run_privileged apt-get update -qq
  run_privileged apt-get install -y -qq ca-certificates curl gnupg
  run_privileged install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL https://download.docker.com/linux/debian/gpg \
      | run_privileged gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    run_privileged chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" \
    | run_privileged tee /etc/apt/sources.list.d/docker.list >/dev/null
  run_privileged apt-get update -qq
  run_privileged apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  if command -v systemctl &>/dev/null; then
    run_privileged systemctl enable --now docker
  fi
}

ensure_docker_access() {
  if docker info >/dev/null 2>&1; then
    ok "Docker daemon reachable"
    return
  fi

  if [[ "$EUID" -ne 0 ]] && command -v sudo &>/dev/null && sudo docker info >/dev/null 2>&1; then
    warn "Docker works with sudo, but current user cannot access Docker directly."
    confirm "Add ${USER:-current user} to the docker group? You must reconnect before deploying." || {
      err "Docker group update declined"
      exit 1
    }
    run_privileged usermod -aG docker "${USER}"
    err "Docker group updated. Log out/in or reconnect SSH, then rerun deploy."
    exit 1
  fi

  err "Docker daemon is not reachable. Check Docker service status and permissions."
  exit 1
}

ensure_prerequisites() {
  hdr "Checking server prerequisites"

  if ! is_debian; then
    err "This deploy self-heal path supports Debian only."
    err "Run the server bootstrap manually or adapt infra/scripts/vps-bootstrap.sh first."
    exit 1
  fi
  ok "Debian-compatible OS detected"

  local missing_packages=()
  command -v git >/dev/null 2>&1 || missing_packages+=(git)
  command -v curl >/dev/null 2>&1 || missing_packages+=(curl)
  command -v node >/dev/null 2>&1 || missing_packages+=(nodejs)
  command -v gzip >/dev/null 2>&1 || missing_packages+=(gzip)
  command -v flock >/dev/null 2>&1 || missing_packages+=(util-linux)
  command -v jq >/dev/null 2>&1 || missing_packages+=(jq)
  command -v gpg >/dev/null 2>&1 || missing_packages+=(gnupg)
  command -v lsb_release >/dev/null 2>&1 || missing_packages+=(lsb-release)
  [[ "${#missing_packages[@]}" -eq 0 ]] || install_apt_packages "${missing_packages[@]}"

  require_cmd git
  require_cmd curl
  require_cmd node
  require_cmd gzip
  require_cmd flock
  require_cmd jq

  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    install_docker_engine
  fi
  require_cmd docker
  docker compose version >/dev/null 2>&1 || { err "Docker Compose v2 plugin missing"; exit 1; }
  ensure_docker_access
  ok "Prerequisites ready"
}

print_secret_key() {
  local key="$1"
  local value="${!key-}"
  [[ -n "$value" ]] || return 0
  printf "    %-40s %s\n" "$key" "$value"
}

print_generated_credentials() {
  [[ -n "${GENERATED_CREDENTIALS:-}" ]] || return 0

  warn "Generated plaintext credentials (also saved to .env on this server):"
  while IFS=$'\t' read -r service username password; do
    [[ -n "$service" ]] || continue
    printf "    %-40s %s\n" "${service}_USERNAME" "$username"
    printf "    %-40s %s\n" "${service}_PASSWORD" "$password"
  done <<< "$GENERATED_CREDENTIALS"
}

# Boxed super admin credentials, printed at the end of the Deployment secrets
# section so the operator saves them with the rest of the vault material.
#
# Every line is derived from WIDTH — no hand-counted padding — and the padded
# text stays pure ASCII on purpose: printf's %-*s pads by bytes under a C
# locale, so a multi-byte dash in a padded string silently shifts the border.
# Box-drawing characters only ever appear in literal format strings.
print_super_admin_credentials() {
  local email="${SEED_ADMIN_EMAIL:-admin@${DOMAIN}}"
  local password="${SEED_ADMIN_PASSWORD:-}"
  local title="SUPER ADMIN CREDENTIALS - SAVE THESE NOW"
  local stored="Stored in .env on this server."
  local state

  case "$SUPER_ADMIN_STATE" in
    created)  state="Account created this deploy - change the password now." ;;
    synced)   state="Password synced from .env and verified." ;;
    existing) state="Account already existed; roles verified." ;;
    *)        state="Bootstrap reported an issue - these values may not work." ;;
  esac

  local rows=("$title" "Email:    $email" "Password: $password" "$stored" "$state")

  # Widen the box rather than burst it when a generated password is long.
  local width=62
  local row
  for row in "${rows[@]}"; do
    (( ${#row} + 4 > width )) && width=$(( ${#row} + 4 ))
  done

  local rule='' i
  for ((i = 0; i < width; i++)); do rule+='═'; done

  local inner=$((width - 2))
  printf '╔%s╗\n' "$rule"
  printf '║  %-*s║\n' "$inner" "$title"
  printf '╠%s╣\n' "$rule"
  printf '║  %-*s║\n' "$inner" "Email:    $email"
  printf '║  %-*s║\n' "$inner" "Password: $password"
  printf '╠%s╣\n' "$rule"
  printf '║  %-*s║\n' "$inner" "$stored"
  printf '║  %-*s║\n' "$inner" "$state"
  printf '╚%s╝\n' "$rule"
}

print_deployment_secrets() {
  hdr "Deployment secrets"
  warn "This output contains secrets. Save it to your vault and treat terminal logs as sensitive."

  local secret_keys=(
    TRAEFIK_DASHBOARD_AUTH
    TRAEFIK_DASHBOARD_PASSWORD
    POSTGRES_PASSWORD
    COOKIE_SECRET
    SUPABASE_JWT_SECRET
    SUPABASE_REALTIME_SECRET
    SUPABASE_REALTIME_DB_ENC_KEY
    SUPABASE_ANON_KEY
    SUPABASE_SERVICE_ROLE_KEY
    MYCLASH_GUEST_JWT_SECRET
    MYCLASH_STAFF_JWT_SECRET
    VAPID_PUBLIC_KEY
    VAPID_PRIVATE_KEY
    OPS_RUNNER_SECRET
    AI_KEY_SECRET
    RESEND_API_KEY
    SMTP_PASS
    BACKUP_SCW_ACCESS_KEY
    BACKUP_SCW_SECRET_KEY
    GOOGLE_OAUTH_CLIENT_SECRET
  )
  # SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are deliberately absent: they print
  # in the credentials box below instead of as two anonymous rows here.

  for key in "${secret_keys[@]}"; do
    print_secret_key "$key"
  done

  if [[ -n "${GENERATED_CREDENTIALS:-}" ]]; then
    echo
    print_generated_credentials
  else
    echo
    info "No new credentials were generated in this deploy."
    info "The current Traefik dashboard password is in .env as TRAEFIK_DASHBOARD_PASSWORD."
  fi

  echo
  print_super_admin_credentials
}

print_service_health_diagnostics() {
  local services=("$@")

  warn "Docker Compose service snapshot:"
  "${COMPOSE[@]}" ps || true

  for svc in "${services[@]}"; do
    local id
    id=$("${COMPOSE[@]}" ps -q "$svc" 2>/dev/null || true)
    if [[ -z "$id" ]]; then
      warn "$svc: no container found"
      continue
    fi

    warn "$svc diagnostics:"
    docker inspect --format='  Status: {{.State.Status}}' "$id" 2>/dev/null || true
    docker inspect --format='  Health: {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || true
    docker inspect --format='  Healthcheck: {{json .Config.Healthcheck.Test}}' "$id" 2>/dev/null || true
    docker inspect --format='  Health log: {{json .State.Health.Log}}' "$id" 2>/dev/null || true
  done
}

ensure_prerequisites

# ── Lock ─────────────────────────────────────────────────────────
LOCK_FILE="$ROOT_DIR/.deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  err "Another deploy is already running. Lock: $LOCK_FILE"
  exit 1
fi
trap 'rm -f "$LOCK_FILE"' EXIT

# ── Validate config ──────────────────────────────────────────────
hdr "Validating configuration"

ENV_RESULT=$(node scripts/ensure-prod-env.mjs .env)
ok ".env validated/repaired"
GENERATED_KEYS=$(node -e "const r=JSON.parse(process.argv[1]); console.log((r.generated||[]).join(' '))" "$ENV_RESULT")
GENERATED_CREDENTIALS=$(node -e "const r=JSON.parse(process.argv[1]); for (const c of r.generatedCredentials||[]) console.log([c.service,c.username,c.password].join('\t'))" "$ENV_RESULT")
PROMPTED_KEYS=$(node -e "const r=JSON.parse(process.argv[1]); console.log((r.prompted||[]).join(' '))" "$ENV_RESULT")
NORMALIZED_KEYS=$(node -e "const r=JSON.parse(process.argv[1]); console.log((r.normalized||[]).join(' '))" "$ENV_RESULT")
[[ -n "$PROMPTED_KEYS" ]] && info "Captured required values: $PROMPTED_KEYS"
[[ -n "$NORMALIZED_KEYS" ]] && info "Normalized values: $NORMALIZED_KEYS"

set -a
source ./.env
set +a

[[ -n "$GENERATED_KEYS" ]] && warn "New secrets generated; the final Deployment secrets section will print all vault values."
[[ -n "$GENERATED_CREDENTIALS" ]] && warn "New plaintext credentials generated; save them from the final Deployment secrets section."

: "${DOMAIN:?Missing DOMAIN in .env}"
: "${LETSENCRYPT_EMAIL:?Missing LETSENCRYPT_EMAIL in .env}"
: "${TRAEFIK_DASHBOARD_AUTH:?Missing TRAEFIK_DASHBOARD_AUTH in .env}"
# Written by ensure-prod-env above, in the same pass as the hash — if this is
# empty the two have been edited apart and the dashboard password is lost.
: "${TRAEFIK_DASHBOARD_PASSWORD:?Missing TRAEFIK_DASHBOARD_PASSWORD in .env}"
: "${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD in .env}"
: "${SUPABASE_JWT_SECRET:?Missing SUPABASE_JWT_SECRET in .env}"
: "${SUPABASE_REALTIME_SECRET:?Missing SUPABASE_REALTIME_SECRET in .env}"
: "${SUPABASE_REALTIME_DB_ENC_KEY:?Missing SUPABASE_REALTIME_DB_ENC_KEY in .env}"
: "${SUPABASE_ANON_KEY:?Missing SUPABASE_ANON_KEY in .env}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Missing SUPABASE_SERVICE_ROLE_KEY in .env}"
: "${MYCLASH_GUEST_JWT_SECRET:?Missing MYCLASH_GUEST_JWT_SECRET in .env}"
: "${MYCLASH_STAFF_JWT_SECRET:?Missing MYCLASH_STAFF_JWT_SECRET in .env}"
: "${COOKIE_SECRET:?Missing COOKIE_SECRET in .env}"
: "${RESEND_API_KEY:?Missing RESEND_API_KEY in .env}"
: "${MAIL_FROM:?Missing MAIL_FROM in .env}"
: "${SMTP_PASS:?Missing SMTP_PASS in .env}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=myclash}"

ok "Environment variables present"

# Compose command: env-file + prod compose file, staging overlay for --dev-certs.
# --env-file is kept absolute ("$ROOT_DIR/.env") so the script works no matter the cwd.
COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)
if [[ "$USE_DEV_CERTS" -eq 1 ]]; then
  COMPOSE+=(-f infra/docker-compose.staging-certs.yml)
  # The overlay no longer redefines traefik's command; it selects the staging CA
  # through these two vars instead. Exported (not passed via --env-file) so they
  # win over .env in Compose's interpolation precedence. Must stay in sync with
  # ACME_FILE below.
  export ACME_STORAGE_FILE=acme-staging.json
  export ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory
  warn "Using Let's Encrypt staging certificates (--dev-certs)"
fi

# ── VAPID / Web Push keys ─────────────────────────────────────────
hdr "Web Push (VAPID) keys"

require_cmd node

VAPID_RESULT=$(node scripts/ensure-vapid-env.mjs .env "$LETSENCRYPT_EMAIL")
set -a
source ./.env
set +a

if [[ "$VAPID_RESULT" == *'"generated":true'* ]]; then
  ok "VAPID keys generated and saved to .env"
else
  ok "VAPID keys already configured"
fi

# ── Sync version stamps (PWA cache busting) ──────────────────────
hdr "Syncing version stamps"

if [[ -f VERSION ]]; then
  APP_VERSION=$(tr -d '[:space:]' < VERSION)
  APP_VERSION_NODOT="${APP_VERSION//./}"

  # Service worker cache names per app
  for sw in apps/web-public/public/sw.js apps/web-scoring/public/sw.js apps/web-admin/public/sw.js; do
    [[ -f "$sw" ]] && sed -i "s/const CACHE_NAME = 'myclash-[^-]*-v[^']*'/const CACHE_NAME = 'myclash-$(basename "$(dirname "$(dirname "$sw")")")-${APP_VERSION}'/" "$sw" || true
  done

  ok "Version ${APP_VERSION} stamped into service workers"
else
  warn "No VERSION file — skipping version stamping"
fi

# ── Prepare directories ──────────────────────────────────────────
hdr "Preparing data and log directories"

mkdir -p \
  logs/api logs/db logs/worker logs/web-public logs/web-scoring logs/web-admin logs/traefik \
  data/postgres data/redis data/storage data/traefik \
  backups/pre-deploy backups/nightly

: > logs/api/api.log
: > logs/traefik/traefik.log

# Mirrors the container-side flag: --acme.storage=/data/${ACME_STORAGE_FILE:-acme.json}
# Derived rather than re-branched on --dev-certs so host and container cannot drift.
ACME_FILE="data/traefik/${ACME_STORAGE_FILE:-acme.json}"

[[ -f "$ACME_FILE" ]] || touch "$ACME_FILE"
chmod 600 "$ACME_FILE"

chmod 775 data/postgres data/redis data/storage logs/* 2>/dev/null || true
ok "Directories ready"

# ── Pre-deploy backup ────────────────────────────────────────────
hdr "Pre-deploy database backup"

if [[ "$SKIP_BACKUP" -eq 1 ]]; then
  warn "Skipping pre-deploy backup (--skip-backup)"
elif ! "${COMPOSE[@]}" ps --status running db 2>/dev/null | grep -q db; then
  warn "Database not running — skipping pre-deploy backup (likely first deploy)"
else
  TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
  BACKUP_FILE="backups/pre-deploy/${TIMESTAMP}.sql.gz"
  info "Dumping to $BACKUP_FILE"
  if "${COMPOSE[@]}" exec -T db \
       pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" 2>/dev/null | gzip > "$BACKUP_FILE"; then
    ok "Backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
  else
    err "Backup failed — aborting deploy"
    exit 1
  fi

  # Prune backups older than 30 days
  find backups/pre-deploy -name "*.sql.gz" -mtime +30 -delete 2>/dev/null || true
fi

# ── Pull latest code ─────────────────────────────────────────────
hdr "Updating code from git"

CURRENT_COMMIT=$(git rev-parse HEAD)
info "Current commit: ${CURRENT_COMMIT:0:8}"

git fetch origin main
NEW_COMMIT=$(git rev-parse origin/main)
info "Target  commit: ${NEW_COMMIT:0:8}"

if [[ "$CURRENT_COMMIT" == "$NEW_COMMIT" ]]; then
  warn "No new commits to deploy"
else
  git reset --hard origin/main
  ok "Code updated"
fi
export GIT_COMMIT="$NEW_COMMIT"

# ── System version manifest ──────────────────────────────────────
hdr "Generating system version manifest"

mkdir -p data
if [[ -d data/system-versions.json ]]; then
  warn "Replacing accidental directory at data/system-versions.json with a manifest file"
  rm -rf -- data/system-versions.json
fi

node scripts/generate-system-versions.mjs \
  --output data/system-versions.json \
  --previous-commit "$CURRENT_COMMIT" \
  --deployed-commit "$NEW_COMMIT" \
  --deployed-at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --deployed-by "${SUDO_USER:-${USER:-unknown}}" \
  --backup-file "${BACKUP_FILE:-none}"
if [[ ! -f data/system-versions.json || ! -s data/system-versions.json ]]; then
  err "System version manifest was not generated as a non-empty file"
  exit 1
fi
ok "System version manifest written to data/system-versions.json"

# ── Build ────────────────────────────────────────────────────────
hdr "Building images"

"${COMPOSE[@]}" build
ok "Images built"

# ── Migrations ───────────────────────────────────────────────────
hdr "Running database migrations"

if [[ "$SKIP_MIGRATIONS" -eq 1 ]]; then
  warn "Skipping migrations (--skip-migrations)"
else
  # Migration runs as a one-off compose run command, not a service.
  # Failure here exits the script before `up` is called — old containers stay up.
  if ! "${COMPOSE[@]}" \
         run --rm api node packages/db/scripts/migrate.mjs; then
    err "Migration failed — deploy aborted; previous version is still running"
    err "Investigate, then either fix and re-run, or rollback with: infra/scripts/rollback.sh"
    exit 1
  fi
  ok "Migrations applied"
fi

# ── Bring up new stack ───────────────────────────────────────────
hdr "Starting stack"

# Bound `up -d` with a hard timeout. Compose v2's progress renderer has been
# observed parking on the last frame even after every container is healthy
# (likely a TTY/SSH interaction with the depends_on wait state machine). We
# don't actually rely on `up -d`'s exit code for readiness — the healthcheck
# poll below is the source of truth. So: an interrupted `up -d` (124 timeout,
# 137 SIGKILL/OOM, 143 SIGTERM) falls through with a warning; any other non-zero
# is still a real failure and aborts.
#
# Capture the exit code with `|| rc=$?` — NOT `if ! cmd; then rc=$?`. Inside a
# negated `if`, `$?` holds the *inverted* status (always 0 when the branch runs),
# so the old form silently reported every failure as "exit 0".
UP_TIMEOUT=120
rc=0
timeout --kill-after=10 "$UP_TIMEOUT" \
  "${COMPOSE[@]}" up -d || rc=$?
if [[ "$rc" -ne 0 ]]; then
  if [[ "$rc" -eq 124 || "$rc" -eq 137 || "$rc" -eq 143 ]]; then
    warn "docker compose up -d exited abnormally (code $rc: timeout/killed) — verifying container state via healthcheck poll"
  else
    err "docker compose up -d failed (exit $rc)"
    print_service_health_diagnostics supabase-rest supabase-storage api
    exit 1
  fi
fi
ok "Stack started"

# Traefik boots even when its plugins fail to fetch (AbortOnPluginFailure stays
# false on purpose), so nothing else would tell the operator the edge lost
# GeoBlock/Fail2Ban. Report loudly; don't abort a deploy over it.
mc_warn_if_plugins_failed || true

# ── Wait for healthchecks ────────────────────────────────────────
hdr "Waiting for services to become healthy"

RETRIES=20
DELAY=3
for svc in api web-public web-scoring web-admin web-marketing supabase-storage; do
  for i in $(seq 1 "$RETRIES"); do
    HEALTH=$(docker inspect --format='{{.State.Health.Status}}' \
              "$("${COMPOSE[@]}" ps -q "$svc")" 2>/dev/null || echo "unknown")
    if [[ "$HEALTH" == "healthy" ]]; then
      ok "$svc healthy"
      break
    fi
    if [[ "$i" -eq "$RETRIES" ]]; then
      err "$svc did not become healthy after $((RETRIES * DELAY))s"
      err "Check logs: docker compose -f infra/docker-compose.prod.yml logs --tail=100 $svc"
      exit 1
    fi
    info "Attempt $i/$RETRIES — $svc status: $HEALTH"
    sleep "$DELAY"
  done
done

# ── Bootstrap super admin (first deploy only) ────────────────────
hdr "Super admin bootstrap"

BOOTSTRAP_RESULT=$("${COMPOSE[@]}" \
  run --rm \
  -e SUPABASE_URL="http://supabase-auth:9999" \
  -e SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}" \
  -e DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}" \
  -e SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@${DOMAIN}}" \
  -e SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD}" \
  api node /app/scripts/bootstrap-super-admin.mjs || echo '{"error":"bootstrap failed"}')

BOOTSTRAP_CREATED=$(node -e "try{const r=JSON.parse(process.argv[1]);console.log(r.created?'yes':'no')}catch{console.log('unknown')}" "$BOOTSTRAP_RESULT")
BOOTSTRAP_PASSWORD_SYNCED=$(node -e "try{const r=JSON.parse(process.argv[1]);console.log(r.passwordSynced?'yes':'no')}catch{console.log('unknown')}" "$BOOTSTRAP_RESULT")
BOOTSTRAP_PASSWORD_VERIFIED=$(node -e "try{const r=JSON.parse(process.argv[1]);console.log(r.passwordVerified?'yes':'no')}catch{console.log('unknown')}" "$BOOTSTRAP_RESULT")
BOOTSTRAP_ERROR=$(node -e "try{const r=JSON.parse(process.argv[1]);console.log(r.error||'')}catch{console.log('parse error')}" "$BOOTSTRAP_RESULT")
BOOTSTRAP_DETAIL=$(node -e "try{const r=JSON.parse(process.argv[1]);console.log(r.detail?JSON.stringify(r.detail):'')}catch{console.log('')}" "$BOOTSTRAP_RESULT")

# The credentials themselves are not printed here — they would scroll away
# under the seeder, smoke test and `compose ps` table. The final Deployment
# secrets section prints them, using SUPER_ADMIN_STATE for the footer.
if [[ -n "$BOOTSTRAP_ERROR" ]]; then
  SUPER_ADMIN_STATE=failed
  warn "Super admin bootstrap reported an issue: $BOOTSTRAP_ERROR"
  [[ -n "$BOOTSTRAP_DETAIL" ]] && warn "Bootstrap detail: $BOOTSTRAP_DETAIL"
  [[ "$BOOTSTRAP_ERROR" == "Failed to verify synced admin user password" ]] && warn "SEED_ADMIN_PASSWORD was not accepted by GoTrue."
  warn "You can run it manually: docker compose run --rm api node /app/scripts/bootstrap-super-admin.mjs"
elif [[ "$BOOTSTRAP_CREATED" == "yes" && "$BOOTSTRAP_PASSWORD_VERIFIED" == "yes" ]]; then
  SUPER_ADMIN_STATE=created
  ok "Super admin account created — credentials print in the final Deployment secrets section"
elif [[ "$BOOTSTRAP_PASSWORD_SYNCED" == "yes" && "$BOOTSTRAP_PASSWORD_VERIFIED" == "yes" ]]; then
  SUPER_ADMIN_STATE=synced
  ok "Super admin account already exists — password synced and verified from SEED_ADMIN_PASSWORD"
else
  SUPER_ADMIN_STATE=existing
  ok "Super admin account already exists — bootstrap roles verified"
fi

# ── Demo / E2E sandbox org (opt-in) ──────────────────────────────
if [[ "$CREATE_DEMO_ORG" -eq 1 ]]; then
  hdr "Creating demo organization"

  if [[ ! -f .env.e2e ]]; then
    err ".env.e2e not found at repo root — required for --create-demo-org"
    err "Copy .env.e2e.example to .env.e2e and set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD / E2E_ORG_SLUG"
    exit 1
  fi

  set -a
  source ./.env.e2e
  set +a
  : "${E2E_ADMIN_EMAIL:?Missing E2E_ADMIN_EMAIL in .env.e2e}"
  : "${E2E_ADMIN_PASSWORD:?Missing E2E_ADMIN_PASSWORD in .env.e2e}"
  : "${E2E_ORG_SLUG:?Missing E2E_ORG_SLUG in .env.e2e}"

  DEMO_ORG_RESULT=$("${COMPOSE[@]}" \
    run --rm \
    -e SUPABASE_URL="http://supabase-auth:9999" \
    -e SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}" \
    -e DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}" \
    -e E2E_ADMIN_EMAIL="${E2E_ADMIN_EMAIL}" \
    -e E2E_ADMIN_PASSWORD="${E2E_ADMIN_PASSWORD}" \
    -e E2E_ORG_SLUG="${E2E_ORG_SLUG}" \
    -e DEMO_ORG_NAME="test ai org" \
    api node /app/scripts/create-demo-org.mjs || echo '{"error":"create-demo-org failed"}')

  DEMO_ORG_ERROR=$(node -e "try{const r=JSON.parse(process.argv[1]);console.log(r.error||'')}catch{console.log('parse error')}" "$DEMO_ORG_RESULT")
  DEMO_ORG_DETAIL=$(node -e "try{const r=JSON.parse(process.argv[1]);console.log(r.detail?JSON.stringify(r.detail):'')}catch{console.log('')}" "$DEMO_ORG_RESULT")

  if [[ -n "$DEMO_ORG_ERROR" ]]; then
    warn "Demo org creation reported an issue: $DEMO_ORG_ERROR"
    [[ -n "$DEMO_ORG_DETAIL" ]] && warn "Bootstrap detail: $DEMO_ORG_DETAIL"
    warn "You can run it manually — see: infra/scripts/deploy.sh --help"
  else
    ok "Demo organization 'test ai org' (${E2E_ORG_SLUG}) ready; owner ${E2E_ADMIN_EMAIL}"
  fi
fi

# ── Smoke test ───────────────────────────────────────────────────
hdr "Smoke test"

if curl -fsSL "https://api.${DOMAIN}/health" >/dev/null 2>&1; then
  ok "API /health reachable"
else
  warn "API /health not reachable from this host (may be a DNS/firewall issue, not a deploy issue)"
fi

# ── Record deploy metadata ───────────────────────────────────────
hdr "Recording deploy metadata"

# Single owner of the elapsed time: the summary below prints this same value, so
# what the operator reads on screen matches what status.sh reports later.
DEPLOY_DURATION=$(( $(date +%s) - DEPLOY_STARTED_AT ))

cat > .last-deploy.json <<EOF
{
  "previousCommit": "$CURRENT_COMMIT",
  "deployedCommit": "$NEW_COMMIT",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "deployedBy": "${SUDO_USER:-${USER:-unknown}}",
  "durationSeconds": $DEPLOY_DURATION,
  "backupFile": "${BACKUP_FILE:-none}"
}
EOF
ok "Metadata saved to .last-deploy.json"

# ── Summary ──────────────────────────────────────────────────────
hdr "Deploy complete"

"${COMPOSE[@]}" ps

echo
ok "Deployed commit ${NEW_COMMIT:0:8} to https://${DOMAIN}"
echo "  Total time:          $(fmt_duration "$DEPLOY_DURATION")"
echo "  Rollback if needed:  infra/scripts/rollback.sh"
echo "  Status:              infra/scripts/status.sh"

echo
print_deployment_secrets
