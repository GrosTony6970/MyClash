-- supabase-baseline.sql
--
-- Minimal Supabase-compatibility baseline so `scripts/replay-db-migrations.mjs`
-- can replay every MyClash migration against a vanilla postgres image (e.g.
-- `postgres:17` — production runs Postgres 17) that has none of the objects the
-- Supabase Postgres image ships with. `pnpm db:migrations:replay` applies this
-- automatically before the migrations; you only need it by hand if you replay
-- migrations yourself.
--
-- Why it is needed (what a vanilla postgres lacks):
--   * Roles `anon` / `authenticated` / `service_role`. Migration 0002 already
--     self-creates the `auth` schema + `auth.uid()` / `auth.jwt()` and *guards*
--     its role grants, so a vanilla DB survives to 0011 — which does
--     `CREATE POLICY ... TO service_role` / `TO authenticated`. A policy that
--     targets a non-existent role errors, so the replay dies there.
--   * `auth.users`. From migration 0030 onward several tables add FKs
--     `REFERENCES auth.users(id)`, which needs the table to exist.
--   * `auth.role()`. 0002 defines auth.uid()/auth.jwt() but not auth.role(),
--     which a later migration calls.
--   * Supabase's default privileges. Without them anon may read nothing, so an
--     anonymous RLS probe of the replay (`pnpm db:rls-probe`) never reaches RLS.
--
-- Every statement is idempotent AND non-destructive, so applying it against a
-- stock Supabase database is a harmless no-op (roles/schema/table already exist;
-- auth.role() is only created when absent, never replacing Supabase's own; the
-- grants are the image's own). On a database whose default privileges were
-- tightened, the grants would widen them again: point it at a disposable one.

-- ── Supabase roles ──────────────────────────────────────────────────────────
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Minimal auth schema + users table (FK target from migration 0030+) ──────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── auth.role() — only when the real Supabase function is absent ─────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'role'
  ) THEN
    CREATE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql STABLE
    AS $fn$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.role', TRUE), ''),
        NULLIF(current_setting('request.jwt.claims', TRUE), '')::jsonb ->> 'role'
      );
    $fn$;
  END IF;
END $$;

-- ── Supabase's default privileges ───────────────────────────────────────────
-- The Supabase image grants anon, authenticated and service_role on every table, view, sequence and
-- function the migrating role creates. A vanilla postgres grants them nothing, so on a bare replay
-- every anonymous read is "permission denied" and RLS is never asked. Granting afterwards is no
-- substitute: it would also re-grant what a migration revoked (0184's views). So the defaults are
-- set here, before the first migration, and each migration's GRANT/REVOKE lands on them as it does
-- in production (`pnpm db:rls-probe` reads the replay as anon).
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
