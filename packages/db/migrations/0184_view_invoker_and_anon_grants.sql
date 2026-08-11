-- Migration 0184: close the three anon-reachable holes Supabase's linter found.
--
-- This is a security fix, not a lint fix. The same exposure model 0141 spells
-- out still applies:
--
--   - PostgREST is routed to the public internet at
--     Host(app.${DOMAIN}) && PathPrefix(/rest/v1) with PGRST_DB_ANON_ROLE:
--     anon, behind no auth middleware (infra/docker-compose.prod.yml).
--   - No migration issues a table-level GRANT, so privileges come from the
--     supabase/postgres image's ALTER DEFAULT PRIVILEGES, which grant
--     anon/authenticated on objects created by the migrating role.
--
-- 0141 closed that for tables by turning RLS on. It could not close it for
-- views or functions, because neither obeys RLS. This migration does.
--
-- ── 1. The five vw_tournament_query_* views ──────────────────────────────
--
-- A view with security_invoker off (the default) runs as its OWNER. The owner
-- here is the migrating role, supabase_admin, created LOGIN SUPERUSER
-- CREATEROLE REPLICATION BYPASSRLS (infra/db/init/01-supabase-roles.sh). So
-- these five views read matches, registrations, persons, clubs, exchanges,
-- referee_assignments and global_persons with RLS switched off entirely, and
-- hand the result to whoever may SELECT the view. That is every fighter name,
-- club, match and referee in the database, including events still in draft —
-- exactly what the 0002 policies exist to hide.
--
-- Both locks go on, because they fail independently and each is free:
--   - security_invoker makes the view honour the CALLER's RLS.
--   - the REVOKE denies anon/authenticated the view outright.
-- If a public surface ever wants one of these, dropping the REVOKE alone
-- leaves a correctly RLS-scoped read rather than an open door.
--
-- Nothing breaks: all nine read sites go through supabase.service (service_role
-- is BYPASSRLS), no browser client and no rpc() touches them.

ALTER VIEW vw_tournament_query_matches          SET (security_invoker = on);
ALTER VIEW vw_tournament_query_exchange_summary SET (security_invoker = on);
ALTER VIEW vw_tournament_query_referees         SET (security_invoker = on);
ALTER VIEW vw_tournament_query_fighters         SET (security_invoker = on);
ALTER VIEW vw_tournament_query_pools            SET (security_invoker = on);

REVOKE ALL ON vw_tournament_query_matches,
              vw_tournament_query_exchange_summary,
              vw_tournament_query_referees,
              vw_tournament_query_fighters,
              vw_tournament_query_pools
  FROM anon, authenticated;

-- ── 2. event_hidden_skills ───────────────────────────────────────────────
--
-- 0076 created it inside the 0048 → 0108 window 0141 swept, and 0141 missed
-- it. Not a judgement call: 0076 writes `CREATE TABLE` without IF NOT EXISTS,
-- and scripts/check-db-review.mjs only collected tables matching
-- `CREATE TABLE IF NOT EXISTS`, so the RLS coverage check never saw this table
-- at all. Seventeen declarations were invisible to that gate; sixteen had RLS
-- by diligence. The gate is widened in the same slice as this migration.
--
-- Shape follows 0141: RLS on, no policies. service_role bypasses RLS, and its
-- only readers/writers are service-role (referees/qualifications.service.ts,
-- exports/archive.service.ts) with org-role authz already enforced in app
-- code. It is not in the supabase_realtime publication.

ALTER TABLE event_hidden_skills ENABLE ROW LEVEL SECURITY;

-- ── 3. The three SECURITY DEFINER functions ──────────────────────────────
--
-- 0156, 0180 and 0182 each end with `revoke all on function ... from public`
-- and a grant to service_role, and 0156's header claims "EXECUTE granted to
-- service_role only". That claim is false, and Supabase's linter proves it:
-- anon AND authenticated can both execute admin_runtime_db_stats today.
--
-- REVOKE ... FROM PUBLIC removes only the catch-all grant. The image's
-- ALTER DEFAULT PRIVILEGES grants EXECUTE to anon and authenticated BY NAME,
-- and a role-specific grant survives a revoke aimed at PUBLIC. The roles have
-- to be named to be revoked.
--
-- Those three migrations are already applied and checksummed by migrate.mjs,
-- so they cannot be corrected in place — their comments stay wrong and this
-- header is the correction. record_query_error and record_device_sync_report
-- are WRITERS; they are unflagged only because they have not been deployed
-- yet, not because their revoke worked.

REVOKE EXECUTE ON FUNCTION public.admin_runtime_db_stats()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.record_query_error(
  text, text, text, boolean, int, text, text, text, text
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.record_device_sync_report(
  uuid, text, text, integer, text[], timestamptz
) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
