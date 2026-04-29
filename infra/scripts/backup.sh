#!/usr/bin/env bash
# infra/scripts/backup.sh — full backup: Postgres + storage + off-site replication
#
# Run from cron nightly:
#   0 3 * * *  /srv/myclash/infra/scripts/backup.sh >> /srv/myclash/logs/backup.log 2>&1

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
cd "$(cd "$SCRIPT_DIR/../.." && pwd)"

[[ -f .env ]] || { err "Missing .env"; exit 1; }

set -a; source ./.env; set +a
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=myclash}"

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BACKUP_DIR="backups/nightly"
mkdir -p "$BACKUP_DIR"

COMPOSE=(docker compose --env-file .env -f infra/docker-compose.prod.yml)

# ── Database dump ────────────────────────────────────────────────
hdr "Postgres dump"

PG_BACKUP="$BACKUP_DIR/db-${TIMESTAMP}.sql.gz"
"${COMPOSE[@]}" exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$PG_BACKUP"
ok "DB dumped to $PG_BACKUP ($(du -h "$PG_BACKUP" | cut -f1))"

# Optional encryption (if BACKUP_GPG_RECIPIENT set in .env)
if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]] && command -v gpg &>/dev/null; then
  gpg --yes --batch --encrypt --recipient "$BACKUP_GPG_RECIPIENT" "$PG_BACKUP"
  rm "$PG_BACKUP"
  PG_BACKUP="${PG_BACKUP}.gpg"
  ok "Encrypted with GPG → $PG_BACKUP"
fi

# ── Storage dump (Supabase Storage volume) ────────────────────────
hdr "Storage rsync"

STORAGE_BACKUP="$BACKUP_DIR/storage-${TIMESTAMP}.tar.gz"
if [[ -d data/storage ]]; then
  tar czf "$STORAGE_BACKUP" -C data storage
  ok "Storage archived to $STORAGE_BACKUP ($(du -h "$STORAGE_BACKUP" | cut -f1))"
else
  warn "No data/storage directory — skipping storage backup"
fi

# ── Off-site replication ─────────────────────────────────────────
hdr "Off-site replication"

if [[ -z "${BACKUP_S3_BUCKET:-}" ]]; then
  warn "BACKUP_S3_BUCKET not set — skipping off-site replication"
elif ! command -v aws &>/dev/null && ! command -v rclone &>/dev/null; then
  warn "Neither aws nor rclone installed — skipping off-site replication"
else
  if command -v rclone &>/dev/null; then
    rclone copy "$BACKUP_DIR" "${BACKUP_S3_REMOTE:-b2}:${BACKUP_S3_BUCKET}/myclash/" \
      --include "*${TIMESTAMP}*" --progress
    ok "Replicated via rclone"
  else
    aws s3 cp "$PG_BACKUP" "s3://${BACKUP_S3_BUCKET}/myclash/$(basename "$PG_BACKUP")"
    [[ -f "$STORAGE_BACKUP" ]] && \
      aws s3 cp "$STORAGE_BACKUP" "s3://${BACKUP_S3_BUCKET}/myclash/$(basename "$STORAGE_BACKUP")"
    ok "Replicated via aws-cli"
  fi
fi

# ── Retention: 30 daily, 12 monthly, 1 yearly ────────────────────
hdr "Local retention"

# Daily: keep last 30 days
find "$BACKUP_DIR" -name "db-*.sql.gz*" -mtime +30 -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "storage-*.tar.gz" -mtime +30 -delete 2>/dev/null || true

# Pre-deploy backups: keep last 30 days too
find "backups/pre-deploy" -name "*.sql.gz*" -mtime +30 -delete 2>/dev/null || true

ok "Pruned local backups older than 30 days"

echo
ok "Backup complete: $TIMESTAMP"
