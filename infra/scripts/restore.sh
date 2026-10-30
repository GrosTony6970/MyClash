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
#   infra/scripts/restore.sh <db-backup-file> --storage-file <storage-backup-file>
#   infra/scripts/restore.sh --storage-only <storage-backup-file>   # images only, DB untouched
#
# Examples:
#   infra/scripts/restore.sh backups/nightly/db-20260501T030000Z.sql.gz
#   infra/scripts/restore.sh --from-s3 20260501T030000Z
#   infra/scripts/restore.sh --storage-only backups/uploads/20260501T030000Z/storage-20260501T030000Z.tar.gz

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
  infra/scripts/restore.sh <db-backup-file> --storage-file <storage-backup-file>
  infra/scripts/restore.sh --storage-only <storage-backup-file>

Restore Postgres and/or Supabase Storage from a backup. Stops app services, drops &
recreates the database, restores from the dump, optionally restores the storage volume,
then restarts the stack. --storage-only replaces the storage volume alone: the database
and every other service are left as they are.

Options:
  --yes                Auto-confirm (non-interactive). Also via MYCLASH_RESTORE_CONFIRM=1.
  --db-only            Restore the database only; skip storage.
  --include-storage    Include storage (default).
  --from-s3 <ts>       Download backups for <timestamp> from Scaleway S3 first.
  --storage-file <f>   Restore storage from <f>, not from backups/nightly/storage-<ts>.
  --storage-only <f>   Restore storage only, from <f>. The images must come from the same
                       night as the database in use: other images leave broken logos.
  -h, --help           Show this help.
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
  echo "  infra/scripts/restore.sh --storage-only <storage-backup-file>"
  exit 0
fi

# ── Arguments ────────────────────────────────────────────────────
# Read by index: a flag with a value (--from-s3, --storage-file, --storage-only) takes the next
# argument. Every refusal here exits before anything is stopped or decrypted.
usage_error() { err "$1"; exit 1; }

AUTO_YES=0
INCLUDE_STORAGE=1
TIMESTAMP_ARG=""
DB_FILE_ARG=""
STORAGE_FILE_ARG=""
STORAGE_ONLY_FILE=""
ARGS=("$@")
i=0
while [[ "$i" -lt "${#ARGS[@]}" ]]; do
  arg="${ARGS[$i]}"
  case "$arg" in
    --yes) AUTO_YES=1 ;;
    --db-only) INCLUDE_STORAGE=0 ;;
    --include-storage) INCLUDE_STORAGE=1 ;;
    --from-s3|--storage-file|--storage-only)
      value="${ARGS[$((i + 1))]:-}"
      [[ -n "$value" && "$value" != -* ]] || usage_error "$arg needs a value."
      case "$arg" in
        --from-s3) TIMESTAMP_ARG="$value" ;;
        --storage-file) STORAGE_FILE_ARG="$value" ;;
        --storage-only) STORAGE_ONLY_FILE="$value" ;;
      esac
      i=$((i + 1))
      ;;
    -*) usage_error "Unknown option: $arg" ;;
    *)
      [[ -z "$DB_FILE_ARG" ]] || usage_error "Give one database backup file, not two."
      DB_FILE_ARG="$arg"
      ;;
  esac
  i=$((i + 1))
done
[[ "${MYCLASH_RESTORE_CONFIRM:-}" == "1" ]] && AUTO_YES=1

STORAGE_ONLY=0
if [[ -n "$STORAGE_ONLY_FILE" ]]; then
  STORAGE_ONLY=1
  if [[ -n "$DB_FILE_ARG$TIMESTAMP_ARG$STORAGE_FILE_ARG" || "$INCLUDE_STORAGE" -eq 0 ]]; then
    usage_error "--storage-only restores the images alone: no database file, --from-s3, --storage-file or --db-only with it."
  fi
elif [[ -n "$DB_FILE_ARG" && -n "$TIMESTAMP_ARG" ]]; then
  usage_error "Give a database backup file or --from-s3 <timestamp>, not both."
elif [[ -z "$DB_FILE_ARG$TIMESTAMP_ARG" ]]; then
  usage_error "Give a database backup file, --from-s3 <timestamp> or --storage-only <file>."
fi
if [[ -n "$STORAGE_FILE_ARG" && ( -n "$TIMESTAMP_ARG" || "$INCLUDE_STORAGE" -eq 0 ) ]]; then
  usage_error "--storage-file goes with a database backup file, without --from-s3 or --db-only."
fi

# ── Resolve the files ────────────────────────────────────────────
BACKUP_FILE=""
STORAGE_FILE=""
if [[ "$STORAGE_ONLY" -eq 1 ]]; then
  STORAGE_FILE="$STORAGE_ONLY_FILE"
elif [[ -n "$TIMESTAMP_ARG" ]]; then
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
elif [[ -n "$STORAGE_FILE_ARG" ]]; then
  BACKUP_FILE="$DB_FILE_ARG"
  STORAGE_FILE="$STORAGE_FILE_ARG"
else
  BACKUP_FILE="$DB_FILE_ARG"
  # Auto-detect matching storage backup
  DB_BASENAME=$(basename "$BACKUP_FILE")
  TS_PART=$(echo "$DB_BASENAME" | grep -oP '\d{8}T\d{6}Z' || echo "")
  if [[ -n "$TS_PART" ]]; then
    CANDIDATE="backups/nightly/storage-${TS_PART}.tar.gz"
    [[ -f "$CANDIDATE" ]] && STORAGE_FILE="$CANDIDATE"
    [[ -f "${CANDIDATE}.gpg" ]] && STORAGE_FILE="${CANDIDATE}.gpg"
  fi
fi

if [[ "$STORAGE_ONLY" -eq 0 ]]; then
  [[ -f "$BACKUP_FILE" ]] || { err "File not found: $BACKUP_FILE"; exit 1; }
fi
# A storage file named on the command line must be there: skipped in silence, the database
# would come back with the images of whatever night the volume holds.
if [[ -n "$STORAGE_ONLY_FILE$STORAGE_FILE_ARG" && ! -f "$STORAGE_FILE" ]]; then
  err "File not found: $STORAGE_FILE"
  exit 1
fi

# ── Confirm ──────────────────────────────────────────────────────
hdr "Restore plan"
if [[ "$STORAGE_ONLY" -eq 1 ]]; then
  info "Storage backup: $STORAGE_FILE"
  warn "This will REPLACE the '$STORAGE_VOLUME' storage volume with the backup archive."
  warn "The database is not touched: the images must come from the same night as the database in use."
  warn "The storage service will be stopped during the restore and restarted afterwards."
else
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
fi
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
# `if`, not `[[ … ]] && rm`: an EXIT trap's last status becomes the script's, so a cleanup with
# no decrypted file to remove turned every restore that worked into exit 1 ("failed").
cleanup_temp() {
  if [[ -n "${TEMP_DECRYPTED_DB:-}" ]]; then rm -f "$TEMP_DECRYPTED_DB"; fi
  if [[ -n "${TEMP_DECRYPTED_STORAGE:-}" ]]; then rm -f "$TEMP_DECRYPTED_STORAGE"; fi
}
trap cleanup_temp EXIT

if [[ "$STORAGE_ONLY" -eq 0 ]]; then
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
fi

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

if [[ "$STORAGE_ONLY" -eq 0 ]]; then
  # ── Stop every service holding a DB connection ─────────────────
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

  # ── Restore Postgres ───────────────────────────────────────────
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

  # ── Validate schema coherence before declaring success ─────────
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

  RESTART=("${COMPOSE[@]}" up -d)
  STORAGE_FAILED="Storage restore FAILED — the database restored OK; restarting the stack so the site recovers with restored data, but storage is stale. Re-run the restore to retry storage."
else
  # The storage volume has ONE mount, supabase-storage: the API and the rest keep running, so the
  # screen can follow the restore. --no-deps: its dependencies were never stopped.
  hdr "Stopping the storage service"
  "${COMPOSE[@]}" stop supabase-storage
  ok "Storage service stopped"
  RESTART=("${COMPOSE[@]}" up -d --no-deps supabase-storage)
  STORAGE_FAILED="Storage restore FAILED — the database was not touched; restarting the storage service. Re-run the restore to retry."
fi

# ── Restore storage volume ───────────────────────────────────────
# Storage objects live in the named volume ${STORAGE_VOLUME}. Clear it
# and extract the (already integrity-checked) archive into it via a
# throwaway root helper so file ownership round-trips.
if [[ "$DO_STORAGE" -eq 1 ]]; then
  hdr "Restoring storage volume ($STORAGE_VOLUME)"
  if ! docker volume inspect "$STORAGE_VOLUME" &>/dev/null; then
    err "Storage volume '$STORAGE_VOLUME' does not exist — cannot restore storage"
    "${RESTART[@]}" || true
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
    err "$STORAGE_FAILED"
    "${RESTART[@]}" || true
    exit 1
  fi
fi

# ── Restart ──────────────────────────────────────────────────────
hdr "Restarting"
"${RESTART[@]}"
ok "Restarted"

echo
ok "Restore complete"
[[ "$STORAGE_ONLY" -eq 1 ]] && warn "The database was not touched."
warn "Run 'infra/scripts/status.sh' to verify all services are healthy."
