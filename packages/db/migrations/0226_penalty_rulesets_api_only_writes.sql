-- 0226: only the API writes penalty rulesets (the 0216 and 0225 pattern).
--
-- THE DEFECT. `penalty_rulesets_insert`, `penalty_rulesets_update` (0016) and the FOR ALL
-- `penalty_entries_all` (0016) let a club's admins write their penalty rulesets and their entries
-- straight through PostgREST, which is public in production, and `penalty_ruleset_versions` (0151,
-- RLS on with no policy) keeps every write grant of both public roles. None of these writes lands
-- today: a signed-in caller's policy check loops through the RLS helpers (ruling 111a leaves it
-- latent; `can_manage_penalty_ruleset` reads the table whose policy calls it). This closes the
-- door so that fixing the loop cannot open it: past the API, a direct UPDATE would change a card's
-- points or an entry's sanction ladder under a running Tournament that pins the ruleset, around
-- the edit guard that refuses an edit of a ruleset in use (apps/api/src/modules/penalties/
-- penalties.service.ts). No app writes these tables but through the API's service role (operator
-- ruling "Penalty door", 2026-10-18).
--
-- WHAT CHANGES. The three write policies go; the SELECT policies `penalty_rulesets_select` and
-- `penalty_entries_select` stay, and they already reach every row the dropped ones did. The two
-- public roles lose their write grants on the three tables, so a stray write fails loudly (42501)
-- instead of touching no row.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table. Reads unchanged; writes from anon and authenticated refused on privilege. The
-- service role (the API) keeps every grant.

-- No IF EXISTS: a mistyped name must fail the replay (0216's rule).
drop policy "penalty_rulesets_insert" on penalty_rulesets;
drop policy "penalty_rulesets_update" on penalty_rulesets;
drop policy "penalty_entries_all" on penalty_ruleset_entries;

revoke insert, update, delete on penalty_rulesets, penalty_ruleset_entries, penalty_ruleset_versions
  from anon, authenticated;
