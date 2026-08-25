-- ─────────────────────────────────────────────────────────────────────────────
-- 0193 — `vw_tournament_query_matches` exposes `end_reason`.
--
-- The view has projected `winner_registration_id`, `red_score` and `blue_score`
-- since 0033 and has never carried `end_reason`. So the tournament-query tools
-- reading it CANNOT see that a bout was stopped by the doubles ceiling: a double
-- loss is 0-0 with no winner, and `rank_fighters` counted it in `matches` while
-- crediting neither a win nor a loss — deflating the win rate the organiser is
-- shown, and the one the assistant reasons from.
--
-- Only `'max_doubles'` means loss for both; `'max_doubles_draw'` is a draw and
-- `'max_doubles_result_stands'` names a real winner. The column is projected
-- raw and the reading is left to the caller, whose owner is `isDoubleLossBout`
-- in @myclash/rules.
--
-- CREATE OR REPLACE cannot ADD a column in the middle of a view's column list,
-- so this appends it at the end. Nothing selects the view by ordinal.
-- Definition otherwise identical to 0164.
-- ─────────────────────────────────────────────────────────────────────────────

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
  m.match_number_label,
  sr.round_number AS swiss_round,
  m.end_reason
FROM matches m
JOIN phases ph ON ph.id = m.phase_id
JOIN tournaments t ON t.id = ph.tournament_id
LEFT JOIN pools po ON po.id = m.pool_id
LEFT JOIN bracket_slots bs ON bs.id = m.bracket_slot_id
LEFT JOIN swiss_rounds sr ON sr.id = m.swiss_round_id
LEFT JOIN lices l ON l.id = m.lice_id
LEFT JOIN registrations rr ON rr.id = m.red_registration_id
LEFT JOIN persons rp ON rp.id = rr.person_id
LEFT JOIN clubs rc ON rc.id = rp.club_id
LEFT JOIN registrations br ON br.id = m.blue_registration_id
LEFT JOIN persons bp ON bp.id = br.person_id
LEFT JOIN clubs bc ON bc.id = bp.club_id;
