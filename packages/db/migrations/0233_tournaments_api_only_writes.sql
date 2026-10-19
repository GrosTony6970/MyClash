-- 0233: only the API writes a Tournament (the 0216 pattern; operator ruling 1 of the audited
-- settings change, 2026-10-17: "close direct writes to the whole Tournament table").
--
-- THE DEFECT. `tournaments_write` (0002) is FOR ALL for a super admin and an organisation admin:
-- it lets either rewrite a Tournament's ruleset pair, its settings, its card pin or its status
-- straight through PostgREST, past every door of the API (the audited re-pin, the lock on a
-- started Tournament's rules, the edit guards). None of these writes lands today: a signed-in
-- policy check loops through the RLS helpers (ruling 111a leaves it latent). This closes the door
-- so that fixing the loop cannot open it. No app writes `tournaments` that way: the API writes as
-- the service role. Two triggers of 0224 refused a foreign ruleset code on that web write; with no
-- write policy left and every writer the service role or a direct login (both exempt) they can
-- never fire. A SECURITY DEFINER function a web role may call and that writes `tournaments` would
-- reach the table with no check below the API: none exists (the only SQL writer of the table is
-- 0066's one-time UPDATE), and one must not be added without its own check.
--
-- WHAT CHANGES.
--   1. `tournaments_write` goes. Reads do not change: its USING is inside `tournaments_select`
--      (0203), which keeps every reader.
--   2. The two public roles lose INSERT, UPDATE and DELETE on `tournaments`, so a stray write
--      fails loudly (42501) instead of touching no row. They keep TRUNCATE, REFERENCES and TRIGGER
--      from the image's default privileges, as on the tables of 0216 and 0227: PostgREST has no
--      TRUNCATE verb and both roles are NOLOGIN, so no web door can use them.
--   3. The two Tournament triggers of 0224 and their function `ruleset_pair_in_its_club` go
--      (operator ruling "0224 triggers", 2026-10-19): a branch that cannot fire is a bug. The
--      Event-move trigger `events_ruleset_pairs_follow_move`, its function and
--      `ruleset_code_offered_to` stay: Events stay writable through PostgREST.
-- Applied files are never edited: the comments of 0199 and 0224 that say an organisation admin
-- may write a Tournament directly are superseded by this header.
--
-- STILL WRITABLE DIRECTLY, named. The lock on a Tournament's rules (the API) reads three columns an
-- organisation admin could still write through PostgREST: `events.status`,
-- `events.penalty_ruleset_id` and `matches.status`. Those writes do not land today (a signed-in
-- policy check loops in the RLS helpers, ruling 111a leaves it latent); whoever fixes the loop must
-- close them too.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no new function. Reads unchanged; writes from anon and authenticated refused on
-- privilege. The service role (the API) keeps every grant.

-- No IF EXISTS on the old name: a mistyped one must fail the replay (0216's rule).
drop policy "tournaments_write" on public.tournaments;

revoke insert, update, delete on public.tournaments from anon, authenticated;

drop trigger tournaments_ruleset_pair_insert on public.tournaments;
drop trigger tournaments_ruleset_pair_update on public.tournaments;
drop function public.ruleset_pair_in_its_club();
