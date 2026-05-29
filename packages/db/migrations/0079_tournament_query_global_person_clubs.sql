-- 0079_tournament_query_global_person_clubs.sql
--
-- vw_tournament_query_matches (and its fighter-shaped sibling) currently
-- resolves the red/blue club via persons.club_id only. For participants
-- created from a HEMA Ratings sync the local persons row often has
-- club_id = NULL — the club lives on the linked global_persons row
-- (persons.global_person_id → global_persons.club_id). Result: club
-- shows on the Persons admin (which pulls via the global mapper) but
-- not on the pools "Matches" tab.
--
-- COALESCE the local persons.club_id with the global_persons.club_id
-- so the view picks up whichever is populated. Same fix applied to
-- vw_tournament_query_fighters for consistency (the schedule and
-- bracket query layers both consume it).
--
-- Idempotent: CREATE OR REPLACE rewrites the view. No data migration.

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
  COALESCE(c_local.name, c_global.name) AS club_name,
  p.hema_ratings_id,
  COALESCE(f.country_code, c_local.country_code, c_global.country_code) AS country_code,
  t.weapon,
  t.category,
  r.status,
  r.seed,
  r.bib_number,
  p.claimed_by_user_id
FROM registrations r
JOIN tournaments t ON t.id = r.tournament_id
JOIN persons p ON p.id = r.person_id
LEFT JOIN global_persons f ON f.id = r.fighter_id
LEFT JOIN clubs c_local ON c_local.id = p.club_id
LEFT JOIN global_persons gp ON gp.id = p.global_person_id
LEFT JOIN clubs c_global ON c_global.id = gp.club_id;

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
  COALESCE(rc_local.name, rc_global.name) AS red_club,
  COALESCE(bc_local.name, bc_global.name) AS blue_club,
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
LEFT JOIN clubs rc_local ON rc_local.id = rp.club_id
LEFT JOIN global_persons rgp ON rgp.id = rp.global_person_id
LEFT JOIN clubs rc_global ON rc_global.id = rgp.club_id
LEFT JOIN registrations br ON br.id = m.blue_registration_id
LEFT JOIN persons bp ON bp.id = br.person_id
LEFT JOIN clubs bc_local ON bc_local.id = bp.club_id
LEFT JOIN global_persons bgp ON bgp.id = bp.global_person_id
LEFT JOIN clubs bc_global ON bc_global.id = bgp.club_id;

COMMIT;
