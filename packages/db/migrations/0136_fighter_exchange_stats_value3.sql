-- 0136: fighter_exchange_stats — close the value-3 gap.
--
-- fighter_exchange_stats (0129) bucketed clean/afterblow hits ONLY at
-- first_strike_value = 1 and = 2. A 3-point hit (allowed by the DTO — max 10 —
-- and by rulesets that configure a 3-pt deep target) therefore vanished from
-- every ✓/✗ column AND from total_exchanges (which summed those buckets), while
-- still counting in blows_given/received and the ratios. Result: an undercounted
-- Total and invisible 3-pt hits in the exchange-detail table.
--
-- Two changes vs 0129:
--   1. Add value-3 buckets (hits_given_3, afterblow_given_3, hits_received_3,
--      afterblow_received_3) mirroring the value-2 ones.
--   2. Make total_exchanges value-INDEPENDENT: blows_given + blows_received +
--      doubles (all clean+afterblow given + all received + doubles, any value).
--      For 1/2-only data this equals the old sum-of-buckets, so existing Totals
--      are unchanged; only value-3 data is corrected.
--
-- The RETURNS TABLE signature changes (4 new columns), which CREATE OR REPLACE
-- cannot do — DROP first. This function is called only via the service-role
-- client (StatsService.getFighterStats), so dropping loses no GRANTs.

DROP FUNCTION IF EXISTS fighter_exchange_stats(UUID);

CREATE FUNCTION fighter_exchange_stats(p_tournament_id UUID)
RETURNS TABLE (
  registration_id UUID,
  person_id UUID,
  given_name TEXT,
  family_name TEXT,
  club_name TEXT,
  doubles BIGINT,
  hits_given_1 BIGINT,
  afterblow_given_1 BIGINT,
  hits_given_2 BIGINT,
  afterblow_given_2 BIGINT,
  hits_given_3 BIGINT,
  afterblow_given_3 BIGINT,
  hits_received_1 BIGINT,
  afterblow_received_1 BIGINT,
  hits_received_2 BIGINT,
  afterblow_received_2 BIGINT,
  hits_received_3 BIGINT,
  afterblow_received_3 BIGINT,
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
      e.first_strike_value,
      e.red_score_delta,
      e.blue_score_delta,
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
  ),
  per_registration AS (
    SELECT
      reg_id,

      -- ── Doubles ────────────────────────────────────────────────────────────────
      COUNT(*) FILTER (WHERE type = 'double') AS doubles,

      -- ── Clean hits GIVEN (attacker) ─────────────────────────────────────────────
      COUNT(*) FILTER (WHERE type = 'clean' AND attacker_reg_id = reg_id AND first_strike_value = 1) AS hits_given_1,
      COUNT(*) FILTER (WHERE type = 'clean' AND attacker_reg_id = reg_id AND first_strike_value = 2) AS hits_given_2,
      COUNT(*) FILTER (WHERE type = 'clean' AND attacker_reg_id = reg_id AND first_strike_value = 3) AS hits_given_3,

      -- ── Afterblow GIVEN (attacker), categorised by the attacker's RAW strike ─────
      COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 1) AS afterblow_given_1,
      COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 2) AS afterblow_given_2,
      COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 3) AS afterblow_given_3,

      -- ── Clean hits RECEIVED (defender) ──────────────────────────────────────────
      COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 1) AS hits_received_1,
      COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 2) AS hits_received_2,
      COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 3) AS hits_received_3,

      -- ── Afterblow RECEIVED (defender), by the attacker's RAW strike (mode-indep) ─
      COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 1) AS afterblow_received_1,
      COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 2) AS afterblow_received_2,
      COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 3) AS afterblow_received_3,

      -- ── Points (scoring-based, mode-aware) ──────────────────────────────────────
      -- The stored per-exchange deltas already net the afterblow mode for every
      -- type (clean, afterblow deductive/full, double=0). own delta = given,
      -- opponent delta = received.
      COALESCE(SUM(CASE WHEN reg_id = red_registration_id THEN red_score_delta  ELSE blue_score_delta END), 0) AS points_given,
      COALESCE(SUM(CASE WHEN reg_id = red_registration_id THEN blue_score_delta ELSE red_score_delta  END), 0) AS points_received,

      -- ── Blow counts (mode-independent, value-independent) ────────────────────────
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
    pr.hits_given_1,
    pr.afterblow_given_1,
    pr.hits_given_2,
    pr.afterblow_given_2,
    pr.hits_given_3,
    pr.afterblow_given_3,
    pr.hits_received_1,
    pr.afterblow_received_1,
    pr.hits_received_2,
    pr.afterblow_received_2,
    pr.hits_received_3,
    pr.afterblow_received_3,
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
