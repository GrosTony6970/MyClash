-- 0216: only the API writes the League tables (operator ruling, 2026-09-30; the 0209 pattern).
--
-- 0015 gave the two public roles write policies on every League table, and nothing took their write
-- grants away, so a caller holding the anon key could write past every check the API makes:
-- - `leagues_insert` let ANY signed-in user insert a League, published and visible included
--   (0215 allows that pair), and the public League list then showed it;
-- - `league_rankings_all` / `league_results_all` let a League's managers write its standings and
--   Tournament results by hand, past the scoring engine (hard rule 1), onto the public table;
-- - `leagues_update`, `league_org_roles_all`, `league_user_roles_all` and `league_links_all` let
--   managers (and a Tournament's club admins, for links) change a League, its roles and its links
--   past the API's permission checks, its link review and its recompute.
-- None of these writes lands today: a signed-in caller's policy check loops through the RLS helpers
-- and errors ("stack depth limit exceeded") once any `platform_roles` row exists (0201 fixed the
-- loop for anon only; ruling 111a leaves the signed-in one latent). The doors close here so that
-- fixing the loop cannot open them.
-- The API's service role is the only writer (every League write in apps/api goes through
-- `supabase.service`; `replace_league_*` (0190) run for the service role only). The seven write
-- policies go and the two public roles lose INSERT, UPDATE and DELETE on the six tables, so a stray
-- write fails loudly (42501) instead of touching no row in silence (ruling 144).
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table. Reads do not change: each dropped FOR ALL policy's USING is already inside its
-- table's SELECT policy (`has_org_role(…, 'admin')` implies `is_org_member(…)`), and the SELECT
-- policies stay. `league_groups` and `league_membership_requests` keep RLS on with no policy (0141):
-- nothing but the service role writes them already. `pnpm db:rls-probe` (check 5) tries each write
-- as the seeded organisation admin, and packages/db/test/league-tables-api-only-writes.test.ts pins
-- the statements.
--
-- No IF EXISTS anywhere: a mistyped name must fail the replay, not pass it.

DROP POLICY "leagues_insert" ON leagues;
DROP POLICY "leagues_update" ON leagues;
DROP POLICY "league_org_roles_all" ON league_organization_roles;
DROP POLICY "league_user_roles_all" ON league_user_roles;
DROP POLICY "league_links_all" ON league_tournament_links;
DROP POLICY "league_results_all" ON league_tournament_results;
DROP POLICY "league_rankings_all" ON league_rankings;

REVOKE INSERT, UPDATE, DELETE ON
  leagues,
  league_organization_roles,
  league_user_roles,
  league_tournament_links,
  league_tournament_results,
  league_rankings
FROM anon, authenticated;
