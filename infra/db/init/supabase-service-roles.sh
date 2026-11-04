#!/bin/bash
# Each service on its own database user (ruling 390). The image ships the narrow login roles
# with NO password: `authenticator` (PostgREST), `supabase_auth_admin` (GoTrue) and
# `supabase_storage_admin` (Storage). This gives each its own password (ruling 392).
#
# Named 'supabase-service-roles.sh' so it runs AFTER the image's 'migrate.sh' (s > m), which
# is what creates those roles. A name like '03-…' runs first, fails on a missing role and
# leaves a volume without the image's roles.
#
# It also gives api requests (service_role, through PostgREST) a 60 s statement limit
# (rulings 395, 397): `authenticator` logs in with 8 s, and PostgREST applies the request
# role's own setting on top. It lives here, not in a migration, because a role setting is
# not in a pg_dump: init runs on every new database, a restored one included. The lock wait
# stays authenticator's 8 s (ruling 398).
#
# Init scripts run once, on a fresh volume. Changing a value later: a wipe, or ALTER ROLE by
# hand.
#
# Plain `set -e` like the other init scripts: the entrypoint SOURCES a non-executable .sh,
# so `set -u` here would carry into the rest of its init. `${VAR:?}` needs no `-u`.
set -e

: "${AUTHENTICATOR_PASSWORD:?AUTHENTICATOR_PASSWORD is empty, PostgREST could not log in}"
: "${SUPABASE_AUTH_ADMIN_PASSWORD:?SUPABASE_AUTH_ADMIN_PASSWORD is empty, GoTrue could not log in}"
: "${SUPABASE_STORAGE_ADMIN_PASSWORD:?SUPABASE_STORAGE_ADMIN_PASSWORD is empty, Storage could not log in}"

# psql variables, not text pasted into SQL: a quote in a value cannot break the statement.
# `\getenv` reads each one from psql's environment, not from `-v` arguments: a command line is
# readable by every user of the host, a container's processes included (ruling 425).
printf '%s\n' \
  '\getenv rest_pw AUTHENTICATOR_PASSWORD' \
  '\getenv auth_pw SUPABASE_AUTH_ADMIN_PASSWORD' \
  '\getenv storage_pw SUPABASE_STORAGE_ADMIN_PASSWORD' \
  "ALTER ROLE authenticator PASSWORD :'rest_pw';" \
  "ALTER ROLE supabase_auth_admin PASSWORD :'auth_pw';" \
  "ALTER ROLE supabase_storage_admin PASSWORD :'storage_pw';" \
  "ALTER ROLE service_role SET statement_timeout = '60s';" |
  psql -v ON_ERROR_STOP=1 --no-psqlrc \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
