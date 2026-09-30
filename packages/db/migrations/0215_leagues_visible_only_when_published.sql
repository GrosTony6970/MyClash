-- 0215: a League is publicly visible only when it is published (ruling 88).
--
-- The public pages show a League only when `status = 'published'` AND `public_visibility`
-- (`isPublicLeague`, leagues.service.ts). The anon policies read one column only:
-- `leagues_public_select` (0015) is `public_visibility OR can_manage_league(id)`, and
-- `league_rankings_select` / `league_results_select` (0015) join on `public_visibility = TRUE`.
-- The two agree only while a visible League is always a published one. 0139 made
-- `LeaguesService.update` derive the flag from the status, and both inserts take the defaults
-- (draft, not visible), but nothing in the database held it: a League manager's own write through
-- PostgREST (`leagues_update`, 0015), a seed, an import or a hand-run SQL fix that set a draft or
-- archived League visible put its name, slug and rankings on `/rest/v1/leagues` for anyone, while
-- every page answered "not found".
--
-- 1. A row already visible without being published loses the flag. The pages hide it already;
--    only the anon policies showed it. Nothing becomes public here.
-- 2. `leagues_visible_only_when_published`: a visible League must be published. A published League
--    that is not visible stays allowed: the pages and the policies both hide it.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no policy change: with the CHECK, `public_visibility` alone now implies
-- `status = 'published'`, so the anon policies match the API's bar.
-- packages/db/test/leagues-visible-only-when-published.test.ts pins the statement.
--
-- No IF EXISTS anywhere: a mistyped name must fail the replay, not pass it.

UPDATE leagues
SET public_visibility = FALSE,
    updated_at = now()
WHERE public_visibility AND status <> 'published';

ALTER TABLE leagues
  ADD CONSTRAINT leagues_visible_only_when_published
  CHECK (NOT public_visibility OR status = 'published');
