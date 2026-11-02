-- 0248: auth.jwt() belongs to GoTrue's own database user (operator ruling 390).
--
-- THE DEFECT. 0002 creates auth.jwt() so its RLS policies can name it, and on a fresh deploy it
-- always runs before GoTrue has ever booted (deploy.sh migrates before `up -d`). So the function
-- is owned by the migrating superuser. Once GoTrue logs in as `supabase_auth_admin` instead of
-- the superuser, its own migration 20220531120530_add_auth_jwt_function does CREATE OR REPLACE
-- on it and stops with "must be owner of function jwt": GoTrue never starts, and nobody can sign
-- in. auth.uid(), auth.role() and auth.email() are created by the image as that user already.
--
-- On a vanilla Postgres replay (packages/db/fixtures/supabase-baseline.sql) the role does not
-- exist and nothing needs it: say so and leave the owner.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;
  ELSE
    RAISE NOTICE '0248: no supabase_auth_admin role (vanilla replay); auth.jwt() keeps its owner';
  END IF;
END $$;
