#!/usr/bin/env bash
# infra/scripts/lib/database-url.sh
#
# ONE owner for the superuser connection string that deploy's one-off commands use: migrate.mjs,
# bootstrap-super-admin.mjs, create-demo-org.mjs. The running api and worker carry no
# DATABASE_URL (ruling 394); each one-off gets it with `-e DATABASE_URL` (the name only, so the
# password never sits in argv). Sourced by deploy.sh, redeploy.sh and CI's Deploy migration run,
# so CI runs deploy's own command.
#
# Requires: POSTGRES_PASSWORD in the environment (.env sourced; .env.example in CI).
: "${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD: source .env before lib/database-url.sh}"
: "${POSTGRES_USER:=supabase_admin}"
: "${POSTGRES_DB:=myclash}"
export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}"

# mc_require_service_role_passwords <compose command...>
#
# The service users get their passwords from an init script, which runs only on a NEW volume. A
# database made before ruling 390 has them without one: GoTrue, PostgREST and Storage would fail
# to log in and sign-in would go down. Ruling 391 is "fresh databases only", so this refuses and
# says so; it does not repair. Run against the db service (it must be up), before migrating.
#
# It fails closed: only "all three users exist and have a password" passes. A query that cannot
# run, or a missing user, is a refusal with its own message, never a silent pass.
mc_require_service_role_passwords() {
  local out
  if ! out=$("$@" exec -T db psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
    "select count(*) filter (where rolpassword is not null) || ' ' || coalesce(string_agg(rolname, ',' order by rolname) filter (where rolpassword is null), '-') from pg_authid where rolname in ('authenticator','supabase_auth_admin','supabase_storage_admin')"); then
    err "Could not read the service database users from the database: refusing to go on."
    return 1
  fi
  if [[ "$out" != "3 -" ]]; then
    err "This database was made before each service had its own user (with password: ${out%% *} of 3; without: ${out#* })."
    err "Wipe it and deploy again (ruling 391): infra/scripts/destroy.sh --full, then deploy.sh."
    return 1
  fi
}
