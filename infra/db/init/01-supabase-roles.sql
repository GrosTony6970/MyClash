-- Supabase cluster-wide roles required by auth, storage, realtime, and postgrest.
-- Mounted into /docker-entrypoint-initdb.d/ so it runs on every fresh database volume.
-- Uses IF NOT EXISTS so it is safe even if the supabase/postgres image already created them.

CREATE ROLE IF NOT EXISTS anon                   NOLOGIN NOINHERIT;
CREATE ROLE IF NOT EXISTS authenticated          NOLOGIN NOINHERIT;
CREATE ROLE IF NOT EXISTS service_role           NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE IF NOT EXISTS supabase_admin         NOLOGIN SUPERUSER CREATEROLE REPLICATION BYPASSRLS;
CREATE ROLE IF NOT EXISTS supabase_auth_admin    NOLOGIN;
CREATE ROLE IF NOT EXISTS supabase_storage_admin NOLOGIN;
CREATE ROLE IF NOT EXISTS supabase_realtime_admin NOLOGIN;
CREATE ROLE IF NOT EXISTS pgsodium_keyholder     NOLOGIN;
CREATE ROLE IF NOT EXISTS dashboard_user         NOLOGIN;

GRANT anon, authenticated, service_role,
      supabase_storage_admin, supabase_auth_admin
  TO supabase_admin;
