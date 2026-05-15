#!/bin/bash
# Creates supabase_admin with LOGIN + password so the image's migrate.sh can
# authenticate (scram-sha-256, pg_hba line 82). All other roles and schemas are
# owned by the image's /docker-entrypoint-initdb.d/init-scripts/00000000000000-initial-schema.sql.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
DO \$\$ BEGIN
  CREATE ROLE supabase_admin LOGIN SUPERUSER CREATEROLE REPLICATION BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END \$\$;
ALTER ROLE supabase_admin PASSWORD '$POSTGRES_PASSWORD';
EOSQL
