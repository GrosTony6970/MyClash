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
#   5. Prune local backups older than 60 days
#   6. Prune remote backups older than 60 days (S3 delete-objects)
#   7. Write a structured summary line to the log
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

COMPOSE=(docker compose --env-file .env -f infra/docker-compose.prod.yml)

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

# ── 5. Local retention (60 days) ────────────────────────────────
hdr "Local retention (${BACKUP_RETENTION_DAYS} days)"

find "$BACKUP_DIR" \
  \( -name "db-*.sql.gz*" -o -name "storage-*.tar.gz*" \) \
  -mtime "+${BACKUP_RETENTION_DAYS}" -delete 2>/dev/null || true

find "$ROOT_DIR/backups/pre-deploy" \
  -name "*.sql.gz*" \
  -mtime "+${BACKUP_RETENTION_DAYS}" -delete 2>/dev/null || true

log_ok "Pruned local backups older than ${BACKUP_RETENTION_DAYS} days"

# ── 6. Remote retention (60 days) ───────────────────────────────
if [[ "$S3_CONFIGURED" -eq 1 ]] && command -v aws &>/dev/null; then
  hdr "Remote retention (${BACKUP_RETENTION_DAYS} days)"

  export AWS_ACCESS_KEY_ID="$BACKUP_SCW_ACCESS_KEY"
  export AWS_SECRET_ACCESS_KEY="$BACKUP_SCW_SECRET_KEY"
  export AWS_DEFAULT_REGION="${BACKUP_SCW_REGION:-fr-par}"

  CUTOFF=$(date -u -d "${BACKUP_RETENTION_DAYS} days ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
           || date -u -v-"${BACKUP_RETENTION_DAYS}"d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
           || echo "")

  if [[ -n "$CUTOFF" ]]; then
    # List objects older than cutoff and delete them
    OBJECTS_TO_DELETE=$(aws s3api list-objects-v2 \
      --bucket "$BACKUP_SCW_BUCKET" \
      --prefix "myclash/" \
      --endpoint-url "$BACKUP_SCW_ENDPOINT" \
      --query "Contents[?LastModified<='${CUTOFF}'].Key" \
      --output text 2>/dev/null || echo "")

    if [[ -n "$OBJECTS_TO_DELETE" && "$OBJECTS_TO_DELETE" != "None" ]]; then
      DELETED_COUNT=0
      while IFS= read -r key; do
        [[ -z "$key" || "$key" == "None" ]] && continue
        if aws s3 rm "s3://${BACKUP_SCW_BUCKET}/${key}" \
             --endpoint-url "$BACKUP_SCW_ENDPOINT" \
             --no-progress 2>/dev/null; then
          DELETED_COUNT=$((DELETED_COUNT + 1))
        fi
      done <<< "$OBJECTS_TO_DELETE"
      log_ok "Deleted $DELETED_COUNT remote objects older than ${BACKUP_RETENTION_DAYS} days"
    else
      log_ok "No remote objects to prune"
    fi
  else
    log_warn "Could not compute cutoff date — skipping remote retention"
  fi
fi

# ── 7. Summary ───────────────────────────────────────────────────
echo
if [[ "$BACKUP_OK" -eq 1 ]]; then
  log_ok "Backup complete: ${TIMESTAMP} | files: ${#UPLOAD_FILES[@]} | S3: $([[ $S3_CONFIGURED -eq 1 ]] && echo yes || echo no)"
else
  log_err "Backup completed with errors: ${TIMESTAMP} — check log above"
  exit 1
fi
