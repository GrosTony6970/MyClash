#!/usr/bin/env bash
# infra/scripts/backup.sh
#
# Nightly backup: Postgres dump + Supabase Storage volume → Scaleway S3.
#
# What it does (in order):
#   1. Dump Postgres to a gzip-compressed SQL file
#   2. Archive the Supabase Storage volume to a tar.gz
#   3. Optionally encrypt both with GPG
#   4. Upload both files to Scaleway S3 (aws-cli, S3-compatible)
#   5. (Retention is enforced by the ops runner, not here — see below.)
#   6. Write a structured summary line to the log
#
# Cron (installed by vps-bootstrap.sh):
#   0 3 * * *  deploy  bash /srv/myclash/infra/scripts/backup.sh \
#                        >> /srv/myclash/logs/backup.log 2>&1
#
# Required .env vars:
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
#   BACKUP_SCW_ACCESS_KEY, BACKUP_SCW_SECRET_KEY
#   BACKUP_SCW_BUCKET, BACKUP_SCW_REGION, BACKUP_SCW_ENDPOINT
#
# Optional .env vars:
#   BACKUP_GPG_RECIPIENT  — if set, encrypt files before upload

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"

ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

# Exports TRAEFIK_BAN_ALLOWLIST + the MW_* middleware prefixes that
# docker-compose.prod.yml interpolates. Compose reads these from this shell,
# not from --env-file, so EVERY script that runs a compose command must source
# it — otherwise compose warns about unset variables and, for the scripts that
# bring the stack up, silently detaches the GeoBlock/Fail2Ban middlewares.
source "$SCRIPT_DIR/lib/traefik-env.sh"

case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: infra/scripts/backup.sh

Nightly backup: dump Postgres + archive the Supabase Storage volume, optionally GPG-
encrypt, then upload both to Scaleway S3. Runs from cron (0 3 * * *); takes no arguments.

Required .env vars:
  POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
  BACKUP_SCW_ACCESS_KEY, BACKUP_SCW_SECRET_KEY, BACKUP_SCW_BUCKET,
  BACKUP_SCW_REGION, BACKUP_SCW_ENDPOINT
Optional .env vars:
  BACKUP_GPG_RECIPIENT   — if set, encrypt files before upload.
EOF
    exit 0
    ;;
esac

# ── Timestamp & log prefix ───────────────────────────────────────
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
LOG_PREFIX="[backup][${TIMESTAMP}]"

log_info()  { info  "${LOG_PREFIX} $*"; }
log_ok()    { ok    "${LOG_PREFIX} $*"; }
log_warn()  { warn  "${LOG_PREFIX} $*"; }
log_err()   { err   "${LOG_PREFIX} $*"; }

log_info "Starting backup"

# ── Load environment ─────────────────────────────────────────────
[[ -f .env ]] || { log_err "Missing .env — aborting"; exit 1; }
set -a
# .env is deploy-time state, never committed — nothing to follow (see .shellcheckrc).
# shellcheck source=/dev/null
source ./.env
set +a

: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=myclash}"
: "${BACKUP_RETENTION_DAYS:=60}"

# ── Validate S3 config ───────────────────────────────────────────
S3_CONFIGURED=0
if [[ -n "${BACKUP_SCW_ACCESS_KEY:-}" && \
      -n "${BACKUP_SCW_SECRET_KEY:-}" && \
      -n "${BACKUP_SCW_BUCKET:-}" && \
      -n "${BACKUP_SCW_ENDPOINT:-}" ]]; then
  S3_CONFIGURED=1
else
  log_warn "Scaleway S3 not configured (BACKUP_SCW_* vars missing) — local backup only"
fi

# ── Prepare directories ──────────────────────────────────────────
BACKUP_DIR="$ROOT_DIR/backups/nightly"
mkdir -p "$BACKUP_DIR"
mkdir -p "$ROOT_DIR/logs"

COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)

# Supabase Storage objects live in this named Docker volume (see
# docker-compose.prod.yml), NOT a host directory. We archive the
# volume's contents via a throwaway helper container.
STORAGE_VOLUME="${BACKUP_STORAGE_VOLUME:-myclash-storage-data}"
STORAGE_HELPER_IMAGE="${BACKUP_STORAGE_HELPER_IMAGE:-alpine:3}"

# Track files to upload
UPLOAD_FILES=()
BACKUP_OK=1

# ── 1. Postgres dump ─────────────────────────────────────────────
hdr "Postgres dump"

PG_FILE="$BACKUP_DIR/db-${TIMESTAMP}.sql.gz"

# Probe the tool before probing the container. `docker compose ps` under
# 2>/dev/null cannot tell "db is stopped" from "compose is not installed here",
# and the runner image ships the Docker CLI without the Compose v2 plugin — so
# a missing plugin used to be reported as a stopped database, producing a
# storage-only backup that still exited 1 with a misleading reason.
if ! "${COMPOSE[@]}" version >/dev/null 2>&1; then
  log_err "docker compose unavailable in this environment — cannot dump Postgres"
  BACKUP_OK=0
elif "${COMPOSE[@]}" ps --status running db 2>/dev/null | grep -q db; then
  # pg_dump takes a consistent MVCC snapshot by default; its stderr is
  # kept (not silenced) so failures surface in the ops-runner log tail.
  if "${COMPOSE[@]}" exec -T db \
       pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
       | gzip > "$PG_FILE"; then
    if gzip -t "$PG_FILE"; then
      PG_SIZE=$(du -h "$PG_FILE" | cut -f1)
      log_ok "Postgres dump: $PG_FILE ($PG_SIZE)"
      UPLOAD_FILES+=("$PG_FILE")
    else
      log_err "Postgres dump failed gzip integrity check (truncated?) — discarding"
      rm -f "$PG_FILE"
      BACKUP_OK=0
    fi
  else
    log_err "pg_dump failed"
    BACKUP_OK=0
  fi
else
  log_warn "DB container not running — skipping Postgres dump"
  BACKUP_OK=0
fi

# ── 2. Storage volume archive ────────────────────────────────────
hdr "Storage volume archive"

STORAGE_FILE="$BACKUP_DIR/storage-${TIMESTAMP}.tar.gz"

if docker volume inspect "$STORAGE_VOLUME" &>/dev/null; then
  # Archive the CONTENTS of the named storage volume via a throwaway
  # helper container (tar in the container, gzip on the host). Restore
  # extracts the same stream back into the volume.
  if docker run --rm -v "$STORAGE_VOLUME:/vol:ro" "$STORAGE_HELPER_IMAGE" \
       tar cf - -C /vol . \
       | gzip > "$STORAGE_FILE"; then
    if gzip -t "$STORAGE_FILE"; then
      STORAGE_SIZE=$(du -h "$STORAGE_FILE" | cut -f1)
      log_ok "Storage archive: $STORAGE_FILE ($STORAGE_SIZE)"
      UPLOAD_FILES+=("$STORAGE_FILE")
    else
      log_err "Storage archive failed gzip integrity check (truncated?) — discarding"
      rm -f "$STORAGE_FILE"
      BACKUP_OK=0
    fi
  else
    log_err "Storage archive failed"
    BACKUP_OK=0
  fi
else
  # Fail the run: a DB-only backup is not a backup. This used to warn and leave
  # BACKUP_OK=1, so a half backup exited 0 and was recorded as a success.
  log_err "Storage volume '$STORAGE_VOLUME' not found — backup is incomplete"
  BACKUP_OK=0
fi

# ── 3. Optional GPG encryption ───────────────────────────────────
# Fail-closed: if a recipient is configured, encryption MUST succeed.
# We never fall back to shipping an unencrypted dump off-site, and we
# delete the plaintext so it can't leak from disk either.
if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  hdr "GPG encryption"
  if ! command -v gpg &>/dev/null; then
    log_err "BACKUP_GPG_RECIPIENT is set but gpg is not installed — refusing to keep/upload unencrypted backups"
    for f in "${UPLOAD_FILES[@]}"; do rm -f "$f"; done
    UPLOAD_FILES=()
    BACKUP_OK=0
  else
    ENCRYPTED_FILES=()
    for f in "${UPLOAD_FILES[@]}"; do
      if gpg --yes --batch --encrypt --recipient "$BACKUP_GPG_RECIPIENT" "$f"; then
        rm -f "$f"
        ENCRYPTED_FILES+=("${f}.gpg")
        log_ok "Encrypted: ${f}.gpg"
      else
        log_err "GPG encryption failed for $f — refusing to keep it unencrypted"
        rm -f "$f"
        BACKUP_OK=0
      fi
    done
    UPLOAD_FILES=("${ENCRYPTED_FILES[@]}")
  fi
fi

# ── 4. Upload to Scaleway S3 ─────────────────────────────────────
if [[ "$S3_CONFIGURED" -eq 1 ]]; then
  hdr "Upload to Scaleway S3"

  if ! command -v aws &>/dev/null; then
    log_err "aws-cli not installed — cannot upload. Install with: apt-get install -y awscli"
    BACKUP_OK=0
  else
    # Configure aws-cli for Scaleway (env-based, no ~/.aws/credentials needed)
    export AWS_ACCESS_KEY_ID="$BACKUP_SCW_ACCESS_KEY"
    export AWS_SECRET_ACCESS_KEY="$BACKUP_SCW_SECRET_KEY"
    export AWS_DEFAULT_REGION="${BACKUP_SCW_REGION:-fr-par}"

    S3_PREFIX="s3://${BACKUP_SCW_BUCKET}/myclash"

    for f in "${UPLOAD_FILES[@]}"; do
      REMOTE_KEY="$S3_PREFIX/$(basename "$f")"
      if aws s3 cp "$f" "$REMOTE_KEY" \
           --endpoint-url "$BACKUP_SCW_ENDPOINT" \
           --no-progress; then
        log_ok "Uploaded: $(basename "$f") → $REMOTE_KEY"
      else
        log_err "Upload failed: $f"
        BACKUP_OK=0
      fi
    done
  fi
else
  log_warn "Skipping S3 upload (not configured)"
fi

# ── 5/6. Retention ──────────────────────────────────────────────
# Retention is enforced by the ops runner after each backup completes
# (count-based, configurable from /admin/backups). BACKUP_RETENTION_DAYS
# stays in .env for backwards compatibility but is no longer used here.
# See `enforceLocalRetention` / `enforceCloudRetention` in
# infra/ops-runner/server.mjs.

# ── 7. Summary ───────────────────────────────────────────────────
echo
if [[ "$BACKUP_OK" -eq 1 ]]; then
  log_ok "Backup complete: ${TIMESTAMP} | files: ${#UPLOAD_FILES[@]} | S3: $([[ $S3_CONFIGURED -eq 1 ]] && echo yes || echo no)"
else
  log_err "Backup completed with errors: ${TIMESTAMP} — check log above"
  exit 1
fi
