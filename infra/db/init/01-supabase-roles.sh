#!/bin/bash
# Supabase cluster-wide roles required by auth, storage, realtime, and postgrest.
# Mounted into /docker-entrypoint-initdb.d/ so it runs on every fresh database volume.
# Shell script (not .sql) so $POSTGRES_PASSWORD can be interpolated for supabase_admin,
# which the image's migrate.sh connects to using scram-sha-256.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
DO \$\$ BEGIN CREATE ROLE anon                    NOLOGIN NOINHERIT;                        EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE authenticated           NOLOGIN NOINHERIT;                        EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE service_role            NOLOGIN NOINHERIT BYPASSRLS;              EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE supabase_admin          LOGIN SUPERUSER CREATEROLE REPLICATION BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE supabase_auth_admin     NOLOGIN;                                  EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE supabase_storage_admin  NOLOGIN;                                  EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE supabase_realtime_admin NOLOGIN;                                  EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE pgsodium_keyholder      NOLOGIN;                                  EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE dashboard_user          NOLOGIN;                                  EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;

ALTER ROLE supabase_admin PASSWORD '$POSTGRES_PASSWORD';

GRANT anon, authenticated, service_role,
      supabase_storage_admin, supabase_auth_admin
  TO supabase_admin;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS realtime;

ALTER SCHEMA auth    OWNER TO supabase_auth_admin;
ALTER SCHEMA storage OWNER TO supabase_storage_admin;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT anon, authenticated, service_role TO postgres;
EOSQL
