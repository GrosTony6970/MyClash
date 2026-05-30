-- 0081_simplify_tournament_views.sql
--
-- persons.club_id stays NULLABLE — independent / unaffiliated
-- fighters are a real domain concept (HEMA Ratings scrapes empty
-- club strings; CSV imports do not require club). But persons.service
-- (createPerson() and applyGlobalPersonDecision()) now eagerly copies
-- global_persons.club_id into persons.club_id when the local value
-- is absent, so the views no longer need to COALESCE between local
-- and global clubs on every read.
--
-- Both views become much cheaper to evaluate (fewer joins per row)
-- and the c_global / rc_global / bc_global complexity is gone.
--
-- Trade-off: if a HEMA re-sync changes global_persons.club_id after
-- a persons row already exists, the view shows the stale club until
-- the persons row is re-edited. Acceptable — today's COALESCE had
-- the same race in the other direction.

BEGIN;

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

CREATE OR REPLACE VIEW vw_tournament_query_matches AS
SELECT
  t.id AS tournament_id,
  t.event_id,
  m.id AS match_id,
  ph.id AS phase_id,
  ph.type AS phase_type,
  po.id AS pool_id,
  po.name AS pool_name,
  bs.round AS bracket_round,
  bs.position AS bracket_position,
  l.id AS lice_id,
  l.name AS lice_name,
  l.sort_order + 1 AS lice_number,
  m.red_registration_id,
  m.blue_registration_id,
  trim(rp.given_name || ' ' || rp.family_name) AS red_name,
  trim(bp.given_name || ' ' || bp.family_name) AS blue_name,
  rc.name AS red_club,
  bc.name AS blue_club,
  m.scheduled_at,
  m.started_at,
  m.ended_at,
  m.duration_active_ms,
  m.duration_total_ms,
  m.red_score,
  m.blue_score,
  m.winner_registration_id,
  m.status,
  m.match_number_label
FROM matches m
JOIN phases ph ON ph.id = m.phase_id
JOIN tournaments t ON t.id = ph.tournament_id
LEFT JOIN pools po ON po.id = m.pool_id
LEFT JOIN bracket_slots bs ON bs.id = m.bracket_slot_id
LEFT JOIN lices l ON l.id = m.lice_id
LEFT JOIN registrations rr ON rr.id = m.red_registration_id
LEFT JOIN persons rp ON rp.id = rr.person_id
LEFT JOIN clubs rc ON rc.id = rp.club_id
LEFT JOIN registrations br ON br.id = m.blue_registration_id
LEFT JOIN persons bp ON bp.id = br.person_id
LEFT JOIN clubs bc ON bc.id = bp.club_id;

COMMIT;
