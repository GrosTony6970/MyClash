-- 0189: fighter blow stats stop hardcoding which point values exist.
--
-- THE DEFECT. `fighter_exchange_stats` counted clean and afterblow blows into
-- FIXED columns, one pair per point value: hits_given_1/2/3,
-- afterblow_given_1/2/3 and the received mirrors. A target may be worth 1 to 10
-- (the DTO's MAX_AUTHORED_TARGET_VALUE, and `exchanges.first_strike_value` is a
-- plain INTEGER with no CHECK), so every hit worth 4 or more was invisible in
-- all twelve columns. Migration 0136 met this exact bug at value 3 and answered
-- it by adding a third pair of columns, which moved the boundary rather than
-- removing it.
--
-- 0135 had already answered it properly, one migration earlier. Its header says
-- so out loud: "fighter_exchange_stats buckets only value=1 and value=2; this
-- function keeps the raw first_strike_value so the API/UI can derive the max
-- dynamically and render an arbitrary number of buckets." This migration takes
-- that shape for the blow counts too.
--
-- WHAT CHANGES.
--   1. New `fighter_blow_value_stats(tournament_id)` — one row per (fighter,
--      point value), carrying the four blow counts for that value. A value with
--      no blows produces no row, so the caller reads which values occurred
--      instead of being told in advance.
--   2. `fighter_exchange_stats` loses its twelve bucket columns. Everything it
--      keeps -- doubles, blows given/received, points, total_exchanges and both
--      ratios -- is already value-independent, which 0136 made true for
--      total_exchanges for the same reason.
--
-- The RETURNS TABLE signature changes, and CREATE OR REPLACE cannot drop
-- columns, so DROP first. Both functions are invoked solely through the
-- service-role client (StatsService), so dropping loses no GRANTs -- the same
-- reasoning 0128, 0129, 0135 and 0136 record.
--
-- Both are LANGUAGE sql STABLE and SECURITY INVOKER (the default). Neither is
-- SECURITY DEFINER, so neither reads with RLS switched off and neither needs the
-- REVOKE that `check-db-review.mjs` demands of a definer.

-- ── Per-(fighter, point value) blow counts ───────────────────────────────────

DROP FUNCTION IF EXISTS fighter_blow_value_stats(UUID);

CREATE FUNCTION fighter_blow_value_stats(p_tournament_id UUID)
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

-- ── fighter_exchange_stats, without the fixed buckets ────────────────────────

DROP FUNCTION IF EXISTS fighter_exchange_stats(UUID);

CREATE FUNCTION fighter_exchange_stats(p_tournament_id UUID)
RETURNS TABLE (
  registration_id UUID,
  person_id UUID,
  given_name TEXT,
  family_name TEXT,
  club_name TEXT,
  doubles BIGINT,
  blows_given BIGINT,
  blows_received BIGINT,
  afterblows_received_total BIGINT,
  points_given BIGINT,
  points_received BIGINT,
  total_exchanges BIGINT,
  hit_ratio NUMERIC,
  point_ratio NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH exchange_data AS (
    SELECT
      e.type,
      e.first_striker_color,
      e.red_score_delta,
      e.blue_score_delta,
      m.red_registration_id,
      m.blue_registration_id,
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
  ),
  per_registration AS (
    SELECT
      reg_id,

      COUNT(*) FILTER (WHERE type = 'double') AS doubles,

      -- ── Points (scoring-based, mode-aware) ──────────────────────────────────
      -- The stored per-exchange deltas already net the afterblow mode for every
      -- type (clean, afterblow deductive/full, double=0). own delta = given,
      -- opponent delta = received.
      COALESCE(SUM(CASE WHEN reg_id = red_registration_id THEN red_score_delta  ELSE blue_score_delta END), 0) AS points_given,
      COALESCE(SUM(CASE WHEN reg_id = red_registration_id THEN blue_score_delta ELSE red_score_delta  END), 0) AS points_received,

      -- ── Blow counts (mode-independent, value-independent) ────────────────────
      COUNT(*) FILTER (WHERE type IN ('clean', 'afterblow') AND attacker_reg_id = reg_id) AS blows_given,
      COUNT(*) FILTER (WHERE type = 'clean'     AND defender_reg_id = reg_id) AS clean_received,
      COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id) AS afterblows_received_total

    FROM exchange_data
    CROSS JOIN LATERAL (
      VALUES (red_registration_id), (blue_registration_id)
    ) AS regs(reg_id)
    GROUP BY reg_id
  )
  SELECT
    pr.reg_id           AS registration_id,
    r.person_id,
    p.given_name::text  AS given_name,     -- ::text guards against varchar→text structure mismatch
    p.family_name::text AS family_name,
    c.name::text        AS club_name,
    pr.doubles,
    pr.blows_given,
    (pr.clean_received + pr.afterblows_received_total) AS blows_received,
    pr.afterblows_received_total,
    pr.points_given,
    pr.points_received,
    -- Value-independent total: all blows given + all blows received + doubles.
    (pr.blows_given + pr.clean_received + pr.afterblows_received_total + pr.doubles) AS total_exchanges,
    ROUND(pr.blows_given::numeric / NULLIF(pr.clean_received + pr.afterblows_received_total, 0), 3) AS hit_ratio,
    ROUND(pr.points_given::numeric / NULLIF(pr.points_received, 0), 3) AS point_ratio
  FROM per_registration pr
  JOIN registrations r ON r.id = pr.reg_id
  JOIN persons       p ON p.id = r.person_id
  LEFT JOIN clubs    c ON c.id = p.club_id
  ORDER BY hit_ratio DESC NULLS LAST;
$$;
