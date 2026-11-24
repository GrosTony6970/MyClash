-- ─────────────────────────────────────────────────────────────────────────────
-- 0284 — `vw_tournament_query_matches` names a team side (team Tournaments, slice 1b-1; ADR-022).
--
-- A side of a Match is a Registration or a team (0282). The view named a side through its
-- Registration only, so a team bout read as two empty names and no winner. Web-admin's Matches tab
-- of a Pool reads the view (`listPoolsWithMatches`), and so do the schedule grid, the piste queue,
-- the reopen preview and the assistant's Tournament queries.
--
-- WHAT CHANGES.
--   1. `red_name` and `blue_name` give the team's name for a team side, the Person's name for a
--      Registration side, as before. A side is one or the other (0282's checks), so COALESCE
--      takes whichever is set. `red_club` and `blue_club` stay the Person's club: a team has no
--      club.
--   2. Five columns appended AT THE END, because CREATE OR REPLACE cannot add a column in the
--      middle (0193's rule): `red_team_id`, `blue_team_id`, `winner_team_id`, and each team's
--      colour name, `red_team_color` and `blue_team_color` (`teams.color`, one of the names of
--      `TOURNAMENT_COLORS`, or none).
--   Definition otherwise identical to 0193.
--
-- WHAT DOES NOT CHANGE. No column is renamed, retyped or moved; every reader's select stays valid.
-- No row is written.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE replaces a view's options with the list it gives: 0193 lost 0184's
-- `security_invoker = on` that way, and 0202 put it back. So this statement carries it in its own
-- `WITH (...)`, and the view keeps running as its caller under RLS. A replace keeps the grants
-- (0202:8): 0184's REVOKE from anon and authenticated stands, and is repeated below so this file
-- alone states the view's posture. No GRANT. Every reader goes through the API's service-role
-- client. `scripts/lib/db-rules.mjs` `viewsMissingSecurityInvoker` reads this file in order, and
-- check 25 of the RLS probe (`team-view-probe.mjs`) reads the view's options and a team bout's
-- names back from a real database.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW vw_tournament_query_matches WITH (security_invoker = on) AS
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
  COALESCE(rt.name, trim(rp.given_name || ' ' || rp.family_name)) AS red_name,
  COALESCE(bt.name, trim(bp.given_name || ' ' || bp.family_name)) AS blue_name,
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
  m.end_reason,
  m.red_team_id,
  m.blue_team_id,
  m.winner_team_id,
  rt.color AS red_team_color,
  bt.color AS blue_team_color
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
LEFT JOIN clubs bc ON bc.id = bp.club_id
LEFT JOIN teams rt ON rt.id = m.red_team_id
LEFT JOIN teams bt ON bt.id = m.blue_team_id;

REVOKE ALL ON vw_tournament_query_matches FROM anon, authenticated;
