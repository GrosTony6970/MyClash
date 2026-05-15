#!/bin/bash
# PostgREST-specific grants that the image's migrate.sh does not add.
# Named 'supabase-postgrest.sh' so it runs AFTER 'migrate.sh' (s > m alphabetically),
# ensuring anon/authenticated/service_role already exist when we GRANT.
#
# GRANT USAGE lets these roles query the public schema.
# GRANT membership lets postgres SET ROLE to them (required by PostgREST).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT anon, authenticated, service_role TO postgres;
EOSQL
