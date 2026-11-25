-- ─────────────────────────────────────────────────────────────────────────────
-- 0285 — `fighter_blow_value_stats` leaves team bouts out (team Tournaments, slice 1b-2).
--
-- THE DEFECT. A side of a Match is a Registration or a team (0282). A team bout holds no
-- Registration, so both `red_registration_id` and `blue_registration_id` are empty. The function
-- (0189) pairs each Exchange with both sides of its bout and groups by that side. On a team bout
-- the group is the empty one, and it gives one all-zero row per point value, with a null
-- `registration_id`. Today only the API drops it, by accident of a cast (`stats.service.ts`).
-- A blow of a team bout is not one Fighter's statistic: personal statistics from team Matches
-- are a non-goal. So the database should not offer them.
--
-- WHAT CHANGES. The `exchange_data` CTE reads only bouts with no team on either side
-- (`red_team_id IS NULL AND blue_team_id IS NULL`). Signature and body are otherwise those of
-- 0189, copied unchanged.
--
-- WHAT DOES NOT NEED CHANGING. `tournament_target_value_stats` (0135) already drops a bout with
-- no attacker Registration (`attacker_reg_id IS NOT NULL`, `:61`), and `fighter_exchange_stats`
-- (0189) joins `registrations` (`:188`), so a team bout gives no row to either.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- LANGUAGE sql STABLE, SECURITY INVOKER (the default); not a SECURITY DEFINER. No GRANT:
-- 0275 left the function to `service_role` alone, and CREATE OR REPLACE keeps that. No table,
-- no row is written.

CREATE OR REPLACE FUNCTION fighter_blow_value_stats(p_tournament_id UUID)
RETURNS TABLE (
  registration_id   UUID,
  point_value       INTEGER,
  hits_given        BIGINT,
  afterblow_given   BIGINT,
  hits_received     BIGINT,
  afterblow_received BIGINT
)
LANGUAGE sql STABLE
AS $$
  WITH exchange_data AS (
    SELECT
      e.type,
      e.first_strike_value,
      m.red_registration_id,
      m.blue_registration_id,
      -- Attacker = first striker; defender = the other fighter.
      CASE
        WHEN e.first_striker_color = 'red'  THEN m.red_registration_id
        WHEN e.first_striker_color = 'blue' THEN m.blue_registration_id
      END AS attacker_reg_id,
      CASE
        WHEN e.first_striker_color = 'red'  THEN m.blue_registration_id
        WHEN e.first_striker_color = 'blue' THEN m.red_registration_id
      END AS defender_reg_id
    FROM exchanges e
    JOIN matches m  ON m.id  = e.match_id
    JOIN phases  ph ON ph.id = m.phase_id
    WHERE ph.tournament_id = p_tournament_id
      AND e.voided = false
      -- A team bout names a team on each side, not a Registration: its blows are no Fighter's.
      AND m.red_team_id IS NULL
      AND m.blue_team_id IS NULL
      -- Only blows carry a point value. A double or a no_exchange has a NULL
      -- first_strike_value and belongs to the value-independent counts in
      -- fighter_exchange_stats, not here.
      AND e.type IN ('clean', 'afterblow')
      AND e.first_strike_value IS NOT NULL
      -- A blow with no striker cannot be attributed to either fighter. Dropping
      -- it here is what lets every (fighter, value) group below hold at least
      -- one real count, so no all-zero row is produced.
      AND e.first_striker_color IS NOT NULL
  )
  SELECT
    regs.reg_id AS registration_id,
    ed.first_strike_value AS point_value,
    COUNT(*) FILTER (WHERE ed.type = 'clean'     AND ed.attacker_reg_id = regs.reg_id) AS hits_given,
    COUNT(*) FILTER (WHERE ed.type = 'afterblow' AND ed.attacker_reg_id = regs.reg_id) AS afterblow_given,
    COUNT(*) FILTER (WHERE ed.type = 'clean'     AND ed.defender_reg_id = regs.reg_id) AS hits_received,
    COUNT(*) FILTER (WHERE ed.type = 'afterblow' AND ed.defender_reg_id = regs.reg_id) AS afterblow_received
  FROM exchange_data ed
  -- One row per fighter per exchange, as fighter_exchange_stats does: a blow is
  -- GIVEN on the attacker's row and RECEIVED on the defender's, so each of the
  -- four counts sees every exchange exactly once.
  CROSS JOIN LATERAL (
    VALUES (ed.red_registration_id), (ed.blue_registration_id)
  ) AS regs(reg_id)
  GROUP BY regs.reg_id, ed.first_strike_value
  -- Ordered by the underlying expressions rather than the RETURNS TABLE column
  -- names, which would be ambiguous against `registrations.registration_id`.
  ORDER BY regs.reg_id, ed.first_strike_value;
$$;
