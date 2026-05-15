-- Ensure Supabase Realtime internal metadata lives outside public.
--
-- Fresh databases also get this schema from infra/db/init/02-supabase-realtime.sh.
-- This migration covers existing production volumes where the init script will
-- not re-run.
CREATE SCHEMA IF NOT EXISTS _realtime;
ALTER SCHEMA _realtime OWNER TO CURRENT_USER;
