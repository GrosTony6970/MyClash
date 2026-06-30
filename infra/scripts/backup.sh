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
set -a; source ./.env; set +a

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

# Track files to upload
UPLOAD_FILES=()
BACKUP_OK=1

# ── 1. Postgres dump ─────────────────────────────────────────────
hdr "Postgres dump"

PG_FILE="$BACKUP_DIR/db-${TIMESTAMP}.sql.gz"

if "${COMPOSE[@]}" ps --status running db 2>/dev/null | grep -q db; then
  if "${COMPOSE[@]}" exec -T db \
       pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" 2>/dev/null \
       | gzip > "$PG_FILE"; then
    PG_SIZE=$(du -h "$PG_FILE" | cut -f1)
    log_ok "Postgres dump: $PG_FILE ($PG_SIZE)"
    UPLOAD_FILES+=("$PG_FILE")
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

if [[ -d "$ROOT_DIR/data/storage" ]]; then
  if tar czf "$STORAGE_FILE" -C "$ROOT_DIR/data" storage 2>/dev/null; then
    STORAGE_SIZE=$(du -h "$STORAGE_FILE" | cut -f1)
    log_ok "Storage archive: $STORAGE_FILE ($STORAGE_SIZE)"
    UPLOAD_FILES+=("$STORAGE_FILE")
  else
    log_err "Storage tar failed"
    BACKUP_OK=0
  fi
else
  log_warn "data/storage not found — skipping storage backup"
fi

# ── 3. Optional GPG encryption ───────────────────────────────────
if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]] && command -v gpg &>/dev/null; then
  hdr "GPG encryption"
  ENCRYPTED_FILES=()
  for f in "${UPLOAD_FILES[@]}"; do
    if gpg --yes --batch --encrypt --recipient "$BACKUP_GPG_RECIPIENT" "$f" 2>/dev/null; then
      rm -f "$f"
      ENCRYPTED_FILES+=("${f}.gpg")
      log_ok "Encrypted: ${f}.gpg"
    else
      log_warn "GPG encryption failed for $f — keeping unencrypted"
      ENCRYPTED_FILES+=("$f")
    fi
  done
  UPLOAD_FILES=("${ENCRYPTED_FILES[@]}")
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
           --no-progress 2>/dev/null; then
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
