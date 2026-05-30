-- 0083_drop_registrations_fighter_id.sql
--
-- Retires the legacy registrations.fighter_id column. Identity now
-- flows entirely through person_id → persons.global_person_id, which
-- the API and the rewritten views (0081) already use.
--
-- The view is dropped first so the column drop has no dependent
-- objects, then recreated with p.global_person_id aliased as
-- fighter_id so consumer code (FighterRow at
-- apps/api/src/modules/tournament-query/tournament-query.tools.service.ts:12)
-- keeps reading the same output column name. Nullability is
-- preserved: both r.fighter_id and p.global_person_id are nullable
-- today, so no regression.

BEGIN;

DROP VIEW IF EXISTS vw_tournament_query_fighters;

ALTER TABLE registrations DROP COLUMN IF EXISTS fighter_id;

CREATE OR REPLACE VIEW vw_tournament_query_fighters AS
SELECT
  r.tournament_id,
  t.event_id,
  r.id AS registration_id,
  p.id AS person_id,
  p.global_person_id AS fighter_id,
  trim(p.given_name || ' ' || p.family_name) AS display_name,
  p.given_name,
  p.family_name,
  c.name AS club_name,
  p.hema_ratings_id,
  COALESCE(gp.country_code, c.country_code) AS country_code,
  t.weapon,
  r.status,
  r.seed,
  r.bib_number,
  p.claimed_by_user_id
FROM registrations r
JOIN tournaments t ON t.id = r.tournament_id
JOIN persons p ON p.id = r.person_id
LEFT JOIN clubs c ON c.id = p.club_id
LEFT JOIN global_persons gp ON gp.id = p.global_person_id;

COMMIT;
