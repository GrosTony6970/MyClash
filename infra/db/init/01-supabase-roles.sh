#!/bin/bash
# Creates supabase_admin with LOGIN + password so the image's migrate.sh can
# authenticate (scram-sha-256, pg_hba line 82). All other roles and schemas are
# owned by the image's /docker-entrypoint-initdb.d/init-scripts/00000000000000-initial-schema.sql.
#
# The image logs every DDL statement (log_statement = 'ddl'), so a password set in SQL text
# lands in the db log (ruling 423b). Logging is off for this session, and for the database until
# supabase-service-roles.sh resets it: the image's migrate.sh, which runs between the two, sets
# supabase_admin's password again as postgres, a role with no log setting of its own.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
SET log_statement = 'none';
ALTER DATABASE "$POSTGRES_DB" SET log_statement = 'none';
DO \$\$ BEGIN
  CREATE ROLE supabase_admin LOGIN SUPERUSER CREATEROLE REPLICATION BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END \$\$;
ALTER ROLE supabase_admin PASSWORD '$POSTGRES_PASSWORD';
EOSQL
