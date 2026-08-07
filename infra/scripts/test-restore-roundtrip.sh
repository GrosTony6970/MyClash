#!/usr/bin/env bash
# infra/scripts/test-restore-roundtrip.sh
#
# Integration test for the DB backup/restore CORE, proving the two properties
# that matter for "solid + schema-coherent":
#
#   1. POSITIVE — a good dump round-trips: dump -> drop -> restore (with the
#      hardened flags) -> the same auth.users + public rows come back.
#   2. NEGATIVE — a truncated dump FAILS the restore and rolls back to empty,
#      instead of leaving a half-restored database reported as "success"
#      (proves -v ON_ERROR_STOP=1 --single-transaction are effective).
#
# Runs entirely against a DISPOSABLE postgres container — it NEVER touches the
# production database or the real restore.sh service orchestration (stopping
# sidecars, the storage volume, etc. are validated by the manual DR drill in
# docs/DISASTER_RECOVERY.md). Safe to run on any docker host.
#
# Requires: docker. First run pulls the postgres image (a few minutes).
# Usage: bash infra/scripts/test-restore-roundtrip.sh   (or ./test-restore-roundtrip.sh)
#
# Deliberately does NOT source lib/log.sh: this is a self-contained test with plain
# `echo`/PASS/FAIL output (no colors, no shared ops helpers), so it can be copied and
# run in isolation on any docker host.

set -Eeuo pipefail

IMAGE="${TEST_PG_IMAGE:-supabase/postgres:17.6.1.160}"
CID="myclash-restore-test-$$"
DB="myclash_test"
PGUSER="postgres"
WORK="$(mktemp -d)"

cleanup() {
  docker rm -f "$CID" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== Starting disposable postgres ($IMAGE) =="
docker run -d --name "$CID" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER="$PGUSER" -e POSTGRES_DB="$DB" \
  "$IMAGE" >/dev/null

echo "== Waiting for readiness =="
ready=0
for _ in $(seq 1 60); do
  if docker exec "$CID" pg_isready -U "$PGUSER" -d "$DB" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[[ "$ready" -eq 1 ]] || { echo "FAIL: postgres never became ready"; exit 1; }

run()   { docker exec -i "$CID" psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$1" -c "$2" >/dev/null; }
query() { docker exec -i "$CID" psql -tAX -U "$PGUSER" -d "$1" -c "$2" | tr -d '[:space:]'; }

echo "== Seeding fixture (public + auth + storage schemas, FK-bearing rows) =="
run "$DB" "CREATE SCHEMA IF NOT EXISTS auth;"
run "$DB" "CREATE SCHEMA IF NOT EXISTS storage;"
run "$DB" "CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);"
run "$DB" "CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, created_by uuid REFERENCES auth.users(id));"
# Pad public past the restore.sh validation floor (>= 10 public tables).
for n in $(seq 1 12); do run "$DB" "CREATE TABLE public.pad_${n} (id int);"; done
run "$DB" "INSERT INTO auth.users (email) VALUES ('a@example.com'), ('b@example.com');"
run "$DB" "INSERT INTO public.events (name, created_by) SELECT 'E1', id FROM auth.users LIMIT 1;"

users_before="$(query "$DB" 'SELECT count(*) FROM auth.users;')"
events_before="$(query "$DB" 'SELECT count(*) FROM public.events;')"

echo "== Dumping =="
docker exec "$CID" pg_dump -U "$PGUSER" "$DB" | gzip > "$WORK/dump.sql.gz"
gzip -t "$WORK/dump.sql.gz"

restore_from() {
  docker exec -i "$CID" psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" >/dev/null
  docker exec -i "$CID" psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d postgres \
    -c "CREATE DATABASE \"$DB\";" >/dev/null
  gunzip -c "$1" \
    | docker exec -i "$CID" psql -v ON_ERROR_STOP=1 --single-transaction -U "$PGUSER" -d "$DB" >/dev/null
}

echo "== POSITIVE: restore from a good dump =="
restore_from "$WORK/dump.sql.gz"
users_after="$(query "$DB" 'SELECT count(*) FROM auth.users;')"
events_after="$(query "$DB" 'SELECT count(*) FROM public.events;')"
[[ "$users_after" == "$users_before" ]] || { echo "FAIL: auth.users $users_after != $users_before"; exit 1; }
[[ "$events_after" == "$events_before" ]] || { echo "FAIL: public.events $events_after != $events_before"; exit 1; }
echo "  OK: auth.users=$users_after, public.events=$events_after round-tripped"

echo "== NEGATIVE: a truncated dump must FAIL and roll back to empty =="
# Decompress, cut the SQL mid-stream, recompress → a VALID gzip carrying a
# TRUNCATED SQL script, so the failure is psql's (not gunzip's).
gunzip -c "$WORK/dump.sql.gz" > "$WORK/dump.sql"
bytes="$(wc -c < "$WORK/dump.sql")"
head -c "$(( bytes * 6 / 10 ))" "$WORK/dump.sql" | gzip > "$WORK/truncated.sql.gz"
if restore_from "$WORK/truncated.sql.gz" 2>/dev/null; then
  echo "FAIL: truncated dump restore reported success — ON_ERROR_STOP/single-transaction not effective"
  exit 1
fi
leftover="$(query "$DB" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
[[ "$leftover" == "0" ]] || { echo "FAIL: truncated restore left $leftover public tables — not atomic"; exit 1; }
echo "  OK: truncated restore failed and rolled back cleanly (0 public tables)"

echo
echo "PASS: DB restore round-trip is atomic and schema-coherent."
