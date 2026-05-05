#!/usr/bin/env bash
# infra/scripts/restore.sh
#
# Restore Postgres and/or Supabase Storage from a backup.
#
# Usage:
#   infra/scripts/restore.sh                          # interactive: list local backups
#   infra/scripts/restore.sh <db-backup-file>         # restore DB + matching storage if present
#   infra/scripts/restore.sh --from-s3 <timestamp>   # pull from Scaleway S3 then restore
#   infra/scripts/restore.sh <db-backup-file> --yes --db-only
#
# Examples:
#   infra/scripts/restore.sh backups/nightly/db-20260501T030000Z.sql.gz
#   infra/scripts/restore.sh --from-s3 20260501T030000Z

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

[[ -f .env ]] || { err "Missing .env"; exit 1; }
set -a; source ./.env; set +a
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=myclash}"

COMPOSE=(docker compose --env-file .env -f infra/docker-compose.prod.yml)

# ── S3 helper ────────────────────────────────────────────────────
s3_configured() {
  [[ -n "${BACKUP_SCW_ACCESS_KEY:-}" && \
     -n "${BACKUP_SCW_SECRET_KEY:-}" && \
     -n "${BACKUP_SCW_BUCKET:-}" && \
     -n "${BACKUP_SCW_ENDPOINT:-}" ]]
}

s3_env() {
  export AWS_ACCESS_KEY_ID="$BACKUP_SCW_ACCESS_KEY"
  export AWS_SECRET_ACCESS_KEY="$BACKUP_SCW_SECRET_KEY"
  export AWS_DEFAULT_REGION="${BACKUP_SCW_REGION:-fr-par}"
}

# ── No args: show local backups ──────────────────────────────────
if [[ $# -eq 0 ]]; then
  echo
  hdr "Local backups"
  echo "  DB backups:"
  ls -lh backups/nightly/db-*.sql.gz* 2>/dev/null | tail -10 | sed 's/^/    /' \
    || warn "  No local DB backups found"
  echo
  echo "  Storage backups:"
  ls -lh backups/nightly/storage-*.tar.gz* 2>/dev/null | tail -10 | sed 's/^/    /' \
    || warn "  No local storage backups found"
  echo
  if s3_configured && command -v aws &>/dev/null; then
    hdr "Remote backups (Scaleway S3)"
    s3_env
    aws s3 ls "s3://${BACKUP_SCW_BUCKET}/myclash/" \
      --endpoint-url "$BACKUP_SCW_ENDPOINT" 2>/dev/null \
      | sort -r | head -20 | sed 's/^/    /' \
      || warn "  Could not list S3 objects"
    echo
  fi
  echo "Usage:"
  echo "  infra/scripts/restore.sh <db-backup-file>"
  echo "  infra/scripts/restore.sh --from-s3 <timestamp>   (e.g. 20260501T030000Z)"
  exit 0
fi

# ── --from-s3 mode ───────────────────────────────────────────────
FROM_S3=0
TIMESTAMP_ARG=""

AUTO_YES=0
INCLUDE_STORAGE=1
for arg in "$@"; do
  [[ "$arg" == "--yes" ]] && AUTO_YES=1
  [[ "$arg" == "--db-only" ]] && INCLUDE_STORAGE=0
  [[ "$arg" == "--include-storage" ]] && INCLUDE_STORAGE=1
done
[[ "${MYCLASH_RESTORE_CONFIRM:-}" == "1" ]] && AUTO_YES=1

if [[ "${1:-}" == "--from-s3" ]]; then
  FROM_S3=1
  TIMESTAMP_ARG="${2:-}"
  [[ -n "$TIMESTAMP_ARG" ]] || { err "Usage: restore.sh --from-s3 <timestamp>"; exit 1; }

  if ! s3_configured; then
    err "Scaleway S3 not configured (BACKUP_SCW_* vars missing in .env)"
    exit 1
  fi
  if ! command -v aws &>/dev/null; then
    err "aws-cli not installed. Install with: apt-get install -y awscli"
    exit 1
  fi

  hdr "Pulling backups from Scaleway S3 (timestamp: $TIMESTAMP_ARG)"
  s3_env

  mkdir -p backups/nightly

  DB_REMOTE="s3://${BACKUP_SCW_BUCKET}/myclash/db-${TIMESTAMP_ARG}.sql.gz"
  DB_LOCAL="backups/nightly/db-${TIMESTAMP_ARG}.sql.gz"
  STORAGE_REMOTE="s3://${BACKUP_SCW_BUCKET}/myclash/storage-${TIMESTAMP_ARG}.tar.gz"
  STORAGE_LOCAL="backups/nightly/storage-${TIMESTAMP_ARG}.tar.gz"

  # Try encrypted variants too
  for ext in "" ".gpg"; do
    if aws s3 ls "${DB_REMOTE}${ext}" --endpoint-url "$BACKUP_SCW_ENDPOINT" &>/dev/null; then
      aws s3 cp "${DB_REMOTE}${ext}" "${DB_LOCAL}${ext}" \
        --endpoint-url "$BACKUP_SCW_ENDPOINT" --no-progress
      ok "Downloaded: db-${TIMESTAMP_ARG}.sql.gz${ext}"
      DB_LOCAL="${DB_LOCAL}${ext}"
      break
    fi
  done

  [[ -f "$DB_LOCAL" ]] || { err "DB backup not found on S3: $DB_REMOTE"; exit 1; }

  for ext in "" ".gpg"; do
    if aws s3 ls "${STORAGE_REMOTE}${ext}" --endpoint-url "$BACKUP_SCW_ENDPOINT" &>/dev/null; then
      aws s3 cp "${STORAGE_REMOTE}${ext}" "${STORAGE_LOCAL}${ext}" \
        --endpoint-url "$BACKUP_SCW_ENDPOINT" --no-progress
      ok "Downloaded: storage-${TIMESTAMP_ARG}.tar.gz${ext}"
      STORAGE_LOCAL="${STORAGE_LOCAL}${ext}"
      break
    fi
  done

  BACKUP_FILE="$DB_LOCAL"
  STORAGE_FILE="${STORAGE_LOCAL:-}"
else
  BACKUP_FILE="$1"
  # Auto-detect matching storage backup
  DB_BASENAME=$(basename "$BACKUP_FILE")
  TS_PART=$(echo "$DB_BASENAME" | grep -oP '\d{8}T\d{6}Z' || echo "")
  STORAGE_FILE=""
  if [[ -n "$TS_PART" ]]; then
    CANDIDATE="backups/nightly/storage-${TS_PART}.tar.gz"
    [[ -f "$CANDIDATE" ]] && STORAGE_FILE="$CANDIDATE"
    [[ -f "${CANDIDATE}.gpg" ]] && STORAGE_FILE="${CANDIDATE}.gpg"
  fi
fi

[[ -f "$BACKUP_FILE" ]] || { err "File not found: $BACKUP_FILE"; exit 1; }

# ── Confirm ──────────────────────────────────────────────────────
hdr "Restore plan"
info "DB backup:      $BACKUP_FILE"
[[ -n "$STORAGE_FILE" ]] && info "Storage backup: $STORAGE_FILE" || warn "No storage backup found — DB only"
info "Target DB:      $POSTGRES_DB on db container"
warn "This will DROP the existing $POSTGRES_DB database and recreate it."
[[ -n "$STORAGE_FILE" ]] && warn "This will REPLACE data/storage with the backup archive."
echo
if [[ "$AUTO_YES" -eq 1 ]]; then
  warn "Proceeding non-interactively because --yes or MYCLASH_RESTORE_CONFIRM=1 was provided."
else
  confirm "Proceed?" || { warn "Aborted."; exit 0; }
fi

# ── Stop app services ────────────────────────────────────────────
hdr "Stopping app services"
"${COMPOSE[@]}" stop api web-public web-scoring web-admin worker 2>/dev/null || true
ok "App services stopped"

# ── Decrypt DB if needed ─────────────────────────────────────────
RESTORE_DB_FILE="$BACKUP_FILE"
TEMP_DECRYPTED_DB=""
if [[ "$BACKUP_FILE" == *.gpg ]]; then
  hdr "Decrypting DB backup"
  TEMP_DECRYPTED_DB="${BACKUP_FILE%.gpg}.tmp"
  gpg --decrypt --output "$TEMP_DECRYPTED_DB" "$BACKUP_FILE"
  RESTORE_DB_FILE="$TEMP_DECRYPTED_DB"
  ok "Decrypted DB backup"
fi

# ── Restore Postgres ─────────────────────────────────────────────
hdr "Restoring Postgres"
"${COMPOSE[@]}" exec -T db psql -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};" 2>/dev/null
"${COMPOSE[@]}" exec -T db psql -U "$POSTGRES_USER" -d postgres \
  -c "CREATE DATABASE ${POSTGRES_DB};" 2>/dev/null
ok "Database recreated"

gunzip -c "$RESTORE_DB_FILE" \
  | "${COMPOSE[@]}" exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>/dev/null
ok "Postgres restored from $BACKUP_FILE"

[[ -n "$TEMP_DECRYPTED_DB" ]] && rm -f "$TEMP_DECRYPTED_DB"

# ── Restore Storage volume ───────────────────────────────────────
if [[ "$INCLUDE_STORAGE" -eq 1 && -n "$STORAGE_FILE" && -f "$STORAGE_FILE" ]]; then
  hdr "Restoring Storage volume"

  RESTORE_STORAGE_FILE="$STORAGE_FILE"
  TEMP_DECRYPTED_STORAGE=""
  if [[ "$STORAGE_FILE" == *.gpg ]]; then
    TEMP_DECRYPTED_STORAGE="${STORAGE_FILE%.gpg}.tmp"
    gpg --decrypt --output "$TEMP_DECRYPTED_STORAGE" "$STORAGE_FILE"
    RESTORE_STORAGE_FILE="$TEMP_DECRYPTED_STORAGE"
    ok "Decrypted storage backup"
  fi

  # Stop storage service during restore
  "${COMPOSE[@]}" stop supabase-storage 2>/dev/null || true

  # Replace data/storage
  rm -rf "$ROOT_DIR/data/storage"
  mkdir -p "$ROOT_DIR/data"
  tar xzf "$RESTORE_STORAGE_FILE" -C "$ROOT_DIR/data"
  ok "Storage volume restored from $STORAGE_FILE"

  [[ -n "$TEMP_DECRYPTED_STORAGE" ]] && rm -f "$TEMP_DECRYPTED_STORAGE"
fi

# ── Restart stack ────────────────────────────────────────────────
hdr "Restarting stack"
"${COMPOSE[@]}" up -d
ok "Stack restarted"

echo
ok "Restore complete"
warn "Run 'infra/scripts/status.sh' to verify all services are healthy."
