-- Supabase cluster-wide roles required by auth, storage, realtime, and postgrest.
-- Mounted into /docker-entrypoint-initdb.d/ so it runs on every fresh database volume.
-- CREATE ROLE has no IF NOT EXISTS in PostgreSQL; use DO blocks with duplicate_object guard.

DO $$ BEGIN CREATE ROLE anon                    NOLOGIN NOINHERIT;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated           NOLOGIN NOINHERIT;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role            NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE supabase_admin          NOLOGIN SUPERUSER CREATEROLE REPLICATION BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE supabase_auth_admin     NOLOGIN;                    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE supabase_storage_admin  NOLOGIN;                    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE supabase_realtime_admin NOLOGIN;                    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE pgsodium_keyholder      NOLOGIN;                    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE dashboard_user          NOLOGIN;                    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT anon, authenticated, service_role,
      supabase_storage_admin, supabase_auth_admin
  TO supabase_admin;

-- Required Supabase schemas
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS realtime;

ALTER SCHEMA auth    OWNER TO supabase_auth_admin;
ALTER SCHEMA storage OWNER TO supabase_storage_admin;
