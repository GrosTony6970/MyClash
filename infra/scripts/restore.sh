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

# Exports TRAEFIK_BAN_ALLOWLIST + the MW_* middleware prefixes that
# docker-compose.prod.yml interpolates. Compose reads these from this shell,
# not from --env-file, so EVERY script that runs a compose command must source
# it — otherwise compose warns about unset variables and, for the scripts that
# bring the stack up, silently detaches the GeoBlock/Fail2Ban middlewares.
source "$SCRIPT_DIR/lib/traefik-env.sh"

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      cat <<'EOF'
Usage:
  infra/scripts/restore.sh                          # interactive: list local backups
  infra/scripts/restore.sh <db-backup-file>         # restore DB + matching storage if present
  infra/scripts/restore.sh --from-s3 <timestamp>    # pull from Scaleway S3 then restore
  infra/scripts/restore.sh <db-backup-file> --yes --db-only

Restore Postgres and/or Supabase Storage from a backup. Stops app services, drops &
recreates the database, restores from the dump, optionally restores the storage volume,
then restarts the stack.

Options:
  --yes              Auto-confirm (non-interactive). Also via MYCLASH_RESTORE_CONFIRM=1.
  --db-only          Restore the database only; skip storage.
  --include-storage  Include storage (default).
  --from-s3 <ts>     Download backups for <timestamp> from Scaleway S3 first.
  -h, --help         Show this help.
EOF
      exit 0
      ;;
  esac
done

[[ -f .env ]] || { err "Missing .env"; exit 1; }
set -a
# .env is deploy-time state, never committed — nothing to follow (see .shellcheckrc).
# shellcheck source=/dev/null
source ./.env
set +a
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=myclash}"

COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)

# Supabase Storage objects live in this named Docker volume (see
# docker-compose.prod.yml), NOT in a host directory. Backup/restore
# operate on the volume via a throwaway helper container.
STORAGE_VOLUME="${BACKUP_STORAGE_VOLUME:-myclash-storage-data}"
STORAGE_HELPER_IMAGE="${BACKUP_STORAGE_HELPER_IMAGE:-alpine:3}"

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

# ── Local backup listing ─────────────────────────────────────────
# The empty case is decided BEFORE the pipeline, not after it: the old form was
# `ls … | tail | sed || warn "No local backups found"`, and `||` binds to the
# exit status of the LAST stage — `sed`, which succeeds on empty input. That
# warning could never print, and a box with no backups at all showed two blank
# headings instead.
print_local_backups() {
  local pattern="$1" empty_msg="$2" files=()
  mapfile -t files < <(compgen -G "$pattern" || true)
  if [[ "${#files[@]}" -eq 0 ]]; then
    warn "  $empty_msg"
    return
  fi
  # `ls` is deliberate here (SC2012): this output is read by a human and never
  # parsed, and the names come from our own backup.sh (db-YYYYMMDD-HHMMSS.sql.gz).
  # shellcheck disable=SC2012
  ls -lh "${files[@]}" | tail -10 | sed 's/^/    /'
}

# ── No args: show local backups ──────────────────────────────────
if [[ $# -eq 0 ]]; then
  echo
  hdr "Local backups"
  echo "  DB backups:"
  print_local_backups 'backups/nightly/db-*.sql.gz*' "No local DB backups found"
  echo
  echo "  Storage backups:"
  print_local_backups 'backups/nightly/storage-*.tar.gz*' "No local storage backups found"
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
if [[ -n "$STORAGE_FILE" ]]; then
  info "Storage backup: $STORAGE_FILE"
else
  warn "No storage backup found — DB only"
fi
info "Target DB:      $POSTGRES_DB on db container"
warn "This will DROP the existing $POSTGRES_DB database and recreate it from the dump."
warn "App + Supabase services will be stopped during the restore and restarted afterwards."
[[ -n "$STORAGE_FILE" ]] && warn "This will REPLACE the '$STORAGE_VOLUME' storage volume with the backup archive."
echo
if [[ "$AUTO_YES" -eq 1 ]]; then
  warn "Proceeding non-interactively because --yes or MYCLASH_RESTORE_CONFIRM=1 was provided."
else
  confirm "Proceed?" || { warn "Aborted."; exit 0; }
fi

# ── Decrypt + integrity-check archives BEFORE disrupting services ─
# All non-destructive work happens first: if an archive is missing or
# corrupt we abort here, while the stack is still fully up. Decrypted
# plaintext temp files are removed on exit (incl. failures) by the trap.
RESTORE_DB_FILE="$BACKUP_FILE"
TEMP_DECRYPTED_DB=""
TEMP_DECRYPTED_STORAGE=""
cleanup_temp() {
  [[ -n "${TEMP_DECRYPTED_DB:-}" ]] && rm -f "$TEMP_DECRYPTED_DB"
  [[ -n "${TEMP_DECRYPTED_STORAGE:-}" ]] && rm -f "$TEMP_DECRYPTED_STORAGE"
}
trap cleanup_temp EXIT

if [[ "$BACKUP_FILE" == *.gpg ]]; then
  hdr "Decrypting DB backup"
  TEMP_DECRYPTED_DB="${BACKUP_FILE%.gpg}.tmp"
  gpg --decrypt --output "$TEMP_DECRYPTED_DB" "$BACKUP_FILE"
  RESTORE_DB_FILE="$TEMP_DECRYPTED_DB"
  ok "Decrypted DB backup"
fi

hdr "Verifying DB backup integrity"
gunzip -t "$RESTORE_DB_FILE"
ok "DB backup gzip integrity OK"

DO_STORAGE=0
RESTORE_STORAGE_FILE=""
if [[ "$INCLUDE_STORAGE" -eq 1 && -n "$STORAGE_FILE" && -f "$STORAGE_FILE" ]]; then
  DO_STORAGE=1
  RESTORE_STORAGE_FILE="$STORAGE_FILE"
  if [[ "$STORAGE_FILE" == *.gpg ]]; then
    hdr "Decrypting storage backup"
    TEMP_DECRYPTED_STORAGE="${STORAGE_FILE%.gpg}.tmp"
    gpg --decrypt --output "$TEMP_DECRYPTED_STORAGE" "$STORAGE_FILE"
    RESTORE_STORAGE_FILE="$TEMP_DECRYPTED_STORAGE"
    ok "Decrypted storage backup"
  fi
  hdr "Verifying storage backup integrity"
  gunzip -t "$RESTORE_STORAGE_FILE"
  ok "Storage backup gzip integrity OK"
fi

# ── Stop every service holding a DB connection ───────────────────
# DROP DATABASE fails while ANY session is connected. The Supabase
# sidecars (auth/rest/realtime/storage/meta) keep persistent pools to
# ${POSTGRES_DB}, so they must be stopped too — not just the app tier.
# `docker compose stop` overrides restart:unless-stopped; the final
# `up -d` brings everything back.
#
# supabase-meta holds a pool like the others. supabase-studio does not talk
# to Postgres directly, but it is stopped alongside meta: left running it
# would spend the restore hammering a dead upstream and showing the operator
# a broken console at the exact moment they are watching one.
hdr "Stopping services connected to the database"
"${COMPOSE[@]}" stop \
  api web-public web-staff web-admin worker \
  supabase-auth supabase-rest supabase-realtime supabase-storage \
  supabase-meta supabase-studio
ok "Services stopped"

# ── Restore Postgres ─────────────────────────────────────────────
hdr "Restoring Postgres"
# WITH (FORCE) terminates any straggler backend (PG13+) — belt-and-
# suspenders now that the connected services are stopped above.
"${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB}\" WITH (FORCE);"
"${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -c "CREATE DATABASE \"${POSTGRES_DB}\";"
ok "Database recreated"

# Replay in a single transaction with ON_ERROR_STOP so a truncated or
# corrupt dump rolls the fresh database back to empty instead of
# leaving a half-restored, incoherent database reported as "success".
gunzip -c "$RESTORE_DB_FILE" \
  | "${COMPOSE[@]}" exec -T db \
      psql -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"
ok "Postgres restored from $BACKUP_FILE"

# ── Validate schema coherence before declaring success ───────────
hdr "Validating restored database"
validate_query() {
  "${COMPOSE[@]}" exec -T db \
    psql -v ON_ERROR_STOP=1 -tAX -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1" \
    | tr -d '[:space:]'
}
for schema in public auth storage; do
  if [[ "$(validate_query "SELECT count(*) FROM information_schema.schemata WHERE schema_name='${schema}';")" != "1" ]]; then
    err "Restore validation FAILED: schema '${schema}' missing — restored database is not coherent"
    exit 1
  fi
done
PUBLIC_TABLES=$(validate_query "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
AUTH_USERS=$(validate_query "SELECT count(*) FROM auth.users;")
if [[ "${PUBLIC_TABLES:-0}" -lt 10 ]]; then
  err "Restore validation FAILED: only ${PUBLIC_TABLES:-0} public tables present — restore looks incomplete"
  exit 1
fi
ok "Restore validation passed (public tables=${PUBLIC_TABLES}, auth.users=${AUTH_USERS})"

# ── Restore storage volume ───────────────────────────────────────
# Storage objects live in the named volume ${STORAGE_VOLUME}. Clear it
# and extract the (already integrity-checked) archive into it via a
# throwaway root helper so file ownership round-trips.
if [[ "$DO_STORAGE" -eq 1 ]]; then
  hdr "Restoring storage volume ($STORAGE_VOLUME)"
  if ! docker volume inspect "$STORAGE_VOLUME" &>/dev/null; then
    err "Storage volume '$STORAGE_VOLUME' does not exist — cannot restore storage"
    "${COMPOSE[@]}" up -d || true
    exit 1
  fi
  # gunzip can receive SIGPIPE here: busybox `tar xf -` stops reading at the
  # archive's end-of-file marker without draining gzip's trailing record
  # padding, closing the pipe while gunzip still has bytes queued. The archive
  # was already integrity-checked (gunzip -t) above, so judge success by the
  # EXTRACTOR's exit status (PIPESTATUS[1]) — not gunzip's — otherwise a fully
  # successful restore would be misreported as failed.
  set +o pipefail
  gunzip -c "$RESTORE_STORAGE_FILE" \
    | docker run --rm -i -v "$STORAGE_VOLUME:/vol" "$STORAGE_HELPER_IMAGE" \
        sh -ec 'find /vol -mindepth 1 -delete; tar xf - -C /vol'
  storage_rc=${PIPESTATUS[1]}
  set -o pipefail
  if [[ "$storage_rc" -eq 0 ]]; then
    ok "Storage volume restored from $STORAGE_FILE"
  else
    err "Storage restore FAILED — the database restored OK; restarting the stack so the site recovers with restored data, but storage is stale. Re-run the restore to retry storage."
    "${COMPOSE[@]}" up -d || true
    exit 1
  fi
fi

# ── Restart stack ────────────────────────────────────────────────
hdr "Restarting stack"
"${COMPOSE[@]}" up -d
ok "Stack restarted"

echo
ok "Restore complete"
warn "Run 'infra/scripts/status.sh' to verify all services are healthy."
