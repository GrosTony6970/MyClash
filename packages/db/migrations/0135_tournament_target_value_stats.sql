-- 0135: Per-(fighter, point-value) CLEAN-hit counts for one tournament.
--
-- Powers two ruleset-aware UI features that must NOT hardcode the "deep target"
-- to first_strike_value = 2:
--   (A) Top-5 deep-target hunters — fighters ranked by CLEAN hits at the
--       tournament's HIGHEST first_strike_value (2 in most rulesets, 3 in some).
--   (B) Exchange point-value distribution — CLEAN hit counts grouped by value
--       (1 vs 2, or 1/2/3…) for a stacked bar.
--
-- fighter_exchange_stats buckets only value=1 and value=2; this function keeps
-- the raw first_strike_value so the API/UI can derive the max dynamically and
-- render an arbitrary number of buckets.
--
-- Attribution: a CLEAN exchange has exactly ONE attacker (the first striker), so
-- grouping by attacker_reg_id + first_strike_value counts each exchange exactly
-- once (no double counting, unlike the CROSS JOIN LATERAL in
-- fighter_exchange_stats). afterblow / double / no_exchange are excluded by
-- type = 'clean'; voided exchanges and NULL first_strike_value / NULL attacker
-- are excluded.
--
-- Per-tournament surface only (public tournament stats page + organizer event
-- rollup), so — like fighter_exchange_stats (0129) — it does NOT filter
-- is_test_event: a tournament's own stats must reflect that tournament.
--
-- Invoked solely via the service-role client (StatsService), so no GRANT is
-- required (mirrors 0128/0129).

CREATE OR REPLACE FUNCTION tournament_target_value_stats(p_tournament_id UUID)
RETURNS TABLE (
  registration_id UUID,
  person_id       UUID,
  given_name      TEXT,
  family_name     TEXT,
  club_name       TEXT,
  point_value     INTEGER,
  clean_hits      BIGINT
)
LANGUAGE sql STABLE
AS $$
  WITH exchange_data AS (
    SELECT
      e.type,
      e.first_strike_value,
      CASE
        WHEN e.first_striker_color = 'red'  THEN m.red_registration_id
        WHEN e.first_striker_color = 'blue' THEN m.blue_registration_id
      END AS attacker_reg_id
    FROM exchanges e
    JOIN matches m  ON m.id  = e.match_id
    JOIN phases  ph ON ph.id = m.phase_id
    WHERE ph.tournament_id = p_tournament_id
      AND e.voided = false
  ),
  per_reg_value AS (
    SELECT
      attacker_reg_id    AS reg_id,
      first_strike_value AS point_value,
      COUNT(*)           AS clean_hits
    FROM exchange_data
    WHERE type = 'clean'
      AND attacker_reg_id    IS NOT NULL
      AND first_strike_value IS NOT NULL
    GROUP BY attacker_reg_id, first_strike_value
  )
  SELECT
    prv.reg_id          AS registration_id,
    r.person_id,
    p.given_name::text  AS given_name,   -- ::text guards varchar→text structure mismatch
    p.family_name::text AS family_name,
    c.name::text        AS club_name,
    prv.point_value,
    prv.clean_hits
  FROM per_reg_value prv
  JOIN registrations r ON r.id = prv.reg_id
  JOIN persons       p ON p.id = r.person_id
  LEFT JOIN clubs    c ON c.id = p.club_id
  ORDER BY prv.point_value ASC, prv.clean_hits DESC;
$$;
