-- Migration 0049: retire tournaments.category in favour of league_groups.
--
-- Steps (must run in this order):
-- 1. Auto-seed a league_groups row per distinct (league_id, category)
--    pair so the new model has groups where the old model had categories.
-- 2. Backfill league_tournament_links.group_id from those new rows
--    (skip rows that already have a group_id explicitly set).
-- 3. Mark the MyClash HQ org as a platform org (was a manual post-deploy
--    step in 0047 — folding it in here for convenience).
-- 4. Drop tournaments.category.
--
-- Existing league_rankings.ranking_group_key rows that were derived from
-- weapon::category remain in place until the next league recompute, at
-- which point the scorer (now driven by league_groups.name) overwrites
-- them.

-- 1. Seed groups from distinct (league, tournament.category) pairs.
INSERT INTO league_groups (league_id, name, sort_order)
SELECT DISTINCT
  ltl.league_id,
  t.category,
  0
FROM league_tournament_links ltl
JOIN tournaments t ON t.id = ltl.tournament_id
WHERE t.category IS NOT NULL
  AND ltl.status != 'removed'
ON CONFLICT (league_id, name) DO NOTHING;

-- 2. Backfill group_id on links that don't already have one.
UPDATE league_tournament_links ltl
SET group_id = lg.id
FROM tournaments t, league_groups lg
WHERE ltl.tournament_id = t.id
  AND lg.league_id = ltl.league_id
  AND lg.name = t.category
  AND ltl.group_id IS NULL
  AND t.category IS NOT NULL;

-- 3. Mark MyClash HQ as a platform org.
UPDATE organizations
SET is_platform = TRUE
WHERE slug = 'myclash-hq';

-- 4. Drop the column. The view vw_tournament_query_fighters (created in 0033)
--    still selects t.category, so Postgres refuses the DROP COLUMN with
--    "cannot drop column ... because other objects depend on it". Drop the
--    view first, then drop the column, then recreate the view without the
--    category field. The view consumer (apps/api/.../tournament-query/
--    tournament-query.tools.service.ts) casts to FighterRow which does not
--    include category, so dropping it from the projection is consumer-safe.
DROP VIEW IF EXISTS vw_tournament_query_fighters;

ALTER TABLE tournaments DROP COLUMN IF EXISTS category;

CREATE OR REPLACE VIEW vw_tournament_query_fighters AS
SELECT
  r.tournament_id,
  t.event_id,
  r.id AS registration_id,
  p.id AS person_id,
  r.fighter_id,
  trim(p.given_name || ' ' || p.family_name) AS display_name,
  p.given_name,
  p.family_name,
  c.name AS club_name,
  p.hema_ratings_id,
  COALESCE(f.country_code, c.country_code) AS country_code,
  t.weapon,
  r.status,
  r.seed,
  r.bib_number,
  p.claimed_by_user_id
FROM registrations r
JOIN tournaments t ON t.id = r.tournament_id
JOIN persons p ON p.id = r.person_id
LEFT JOIN global_persons f ON f.id = r.fighter_id
LEFT JOIN clubs c ON c.id = p.club_id;
