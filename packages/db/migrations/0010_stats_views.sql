-- T-1001: Materialized views for fighter exchange stats
-- Produces all columns from the lyonamhe.fr stats table:
-- Dbl, ✓1, ✓1-1, ✓2, ✓2-1, ✗1, ✗1-1, ✗2, ✗2-1, Total, Ratio
--
-- IMPORTANT: Scoring and blow tracking are separate concerns.
--
-- Points (affect scoreboard):
--   afterblow_value = 0 in deductive mode → defender scores 0 pts
--
-- Blow registration (always recorded, regardless of mode):
--   type = 'afterblow' → defender ALWAYS landed a blow
--   This blow appears in hit-rate stats, blow-count totals, and ranking
--   metrics that reward technical output independently of points.
--
-- The view uses exchange TYPE to count blows, not point values.
-- A defender landing an afterblow in deductive mode still gets credit
-- for the blow in all blow-based statistics.

-- ── Enable pg_trgm if not already ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Drop and recreate (idempotent via DROP IF EXISTS) ─────────────────────────
DROP MATERIALIZED VIEW IF EXISTS mv_fighter_exchange_stats;

-- ── Materialized view: fighter exchange stats per tournament ──────────────────

CREATE MATERIALIZED VIEW mv_fighter_exchange_stats AS
WITH exchange_data AS (
  SELECT
    ph.tournament_id,
    e.id            AS exchange_id,
    e.type,
    e.first_striker_color,
    e.first_strike_value,
    e.afterblow_value,
    m.red_registration_id,
    m.blue_registration_id,
    -- Attacker = first striker
    CASE
      WHEN e.first_striker_color = 'red'  THEN m.red_registration_id
      WHEN e.first_striker_color = 'blue' THEN m.blue_registration_id
      ELSE NULL
    END AS attacker_reg_id,
    -- Defender = the other fighter
    CASE
      WHEN e.first_striker_color = 'red'  THEN m.blue_registration_id
      WHEN e.first_striker_color = 'blue' THEN m.red_registration_id
      ELSE NULL
    END AS defender_reg_id
  FROM exchanges e
  JOIN matches m  ON m.id  = e.match_id
  JOIN phases  ph ON ph.id = m.phase_id
  WHERE e.voided = false
),
per_registration AS (
  SELECT
    tournament_id,
    reg_id,

    -- ── Doubles ──────────────────────────────────────────────────────────────
    COUNT(*) FILTER (WHERE type = 'double') AS doubles,

    -- ── Clean hits GIVEN (attacker) ───────────────────────────────────────────
    -- Blow count: type = 'clean' AND this fighter is the attacker
    COUNT(*) FILTER (WHERE type = 'clean' AND attacker_reg_id = reg_id AND first_strike_value = 1) AS hits_given_1,
    COUNT(*) FILTER (WHERE type = 'clean' AND attacker_reg_id = reg_id AND first_strike_value = 2) AS hits_given_2,

    -- ── Afterblow GIVEN (attacker in an afterblow exchange) ───────────────────
    -- Blow count: type = 'afterblow' AND this fighter is the attacker
    -- Uses first_strike_value for the attacker's blow category (1pt or 2pt attack)
    COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 1) AS afterblow_given_1,
    COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 2) AS afterblow_given_2,

    -- ── Clean hits RECEIVED (defender in a clean exchange) ────────────────────
    COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 1) AS hits_received_1,
    COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 2) AS hits_received_2,

    -- ── Afterblow RECEIVED (defender in an afterblow exchange) ────────────────
    -- CRITICAL: counted by exchange TYPE, NOT by afterblow_value.
    -- In deductive mode afterblow_value = 0 (no points), but the blow still
    -- happened and must be counted here.
    -- Category is determined by the attacker's first_strike_value (the exchange
    -- that triggered the afterblow), matching the lyonamhe.fr ✗1-1 / ✗2-1 columns.
    COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 1) AS afterblow_received_1,
    COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 2) AS afterblow_received_2,

    -- ── Points GIVEN (for scoring-based metrics) ──────────────────────────────
    -- These use actual point values and ARE affected by afterblow mode.
    COALESCE(SUM(
      CASE
        WHEN type = 'clean'     AND attacker_reg_id = reg_id THEN first_strike_value
        WHEN type = 'afterblow' AND attacker_reg_id = reg_id THEN first_strike_value
        ELSE 0
      END
    ), 0) AS points_given,

    -- ── Points RECEIVED (for scoring-based metrics) ───────────────────────────
    -- afterblow_value = 0 in deductive mode → defender receives 0 pts (correct)
    COALESCE(SUM(
      CASE
        WHEN type = 'clean'     AND defender_reg_id = reg_id THEN first_strike_value
        WHEN type = 'afterblow' AND defender_reg_id = reg_id THEN COALESCE(afterblow_value, 0)
        ELSE 0
      END
    ), 0) AS points_received,

    -- ── Blow count GIVEN (blow-based metrics, mode-independent) ───────────────
    -- Every clean hit + every afterblow attack = 1 blow given
    COUNT(*) FILTER (WHERE type IN ('clean', 'afterblow') AND attacker_reg_id = reg_id) AS blows_given,

    -- ── Blow count RECEIVED (blow-based metrics, mode-independent) ────────────
    -- Every clean hit received + every afterblow received = 1 blow received
    -- (afterblow_value = 0 does NOT mean no blow was received)
    COUNT(*) FILTER (WHERE type = 'clean'     AND defender_reg_id = reg_id) AS clean_received,
    COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id) AS afterblows_received_total

  FROM exchange_data
  CROSS JOIN LATERAL (
    VALUES (red_registration_id), (blue_registration_id)
  ) AS regs(reg_id)
  GROUP BY tournament_id, reg_id
)
SELECT
  pr.tournament_id,
  pr.reg_id        AS registration_id,
  r.person_id,
  p.given_name,
  p.family_name,
  c.name           AS club_name,

  -- ── lyonamhe.fr columns ───────────────────────────────────────────────────
  pr.doubles,
  pr.hits_given_1,
  pr.afterblow_given_1,
  pr.hits_given_2,
  pr.afterblow_given_2,
  pr.hits_received_1,
  pr.afterblow_received_1,
  pr.hits_received_2,
  pr.afterblow_received_2,

  -- ── Extended blow-based columns (mode-independent) ───────────────────────
  pr.blows_given,
  (pr.clean_received + pr.afterblows_received_total) AS blows_received,
  pr.afterblows_received_total,

  -- ── Point-based columns (affected by afterblow mode) ─────────────────────
  pr.points_given,
  pr.points_received,

  -- ── Totals ────────────────────────────────────────────────────────────────
  (pr.hits_given_1 + pr.afterblow_given_1 + pr.hits_given_2 + pr.afterblow_given_2 +
   pr.hits_received_1 + pr.afterblow_received_1 + pr.hits_received_2 + pr.afterblow_received_2 +
   pr.doubles) AS total_exchanges,

  -- ── Hit ratio (BLOW-based, mode-independent) ─────────────────────────────
  -- Uses blow counts, not point values.
  -- A defender landing an afterblow in deductive mode still contributes here.
  ROUND(
    pr.blows_given::numeric /
    NULLIF(pr.clean_received + pr.afterblows_received_total, 0),
    3
  ) AS hit_ratio,

  -- ── Point ratio (POINT-based, affected by mode) ───────────────────────────
  ROUND(
    pr.points_given::numeric /
    NULLIF(pr.points_received, 0),
    3
  ) AS point_ratio

FROM per_registration pr
JOIN registrations r ON r.id  = pr.reg_id
JOIN persons       p ON p.id  = r.person_id
LEFT JOIN clubs    c ON c.id  = p.club_id;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX mv_fighter_exchange_stats_pk
  ON mv_fighter_exchange_stats (tournament_id, registration_id);

CREATE INDEX mv_fighter_exchange_stats_tournament
  ON mv_fighter_exchange_stats (tournament_id);

-- ── Refresh function ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION refresh_fighter_exchange_stats()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fighter_exchange_stats;
END;
$$;

-- ── Trigger: pg_notify on exchange change ─────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_refresh_exchange_stats()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('refresh_exchange_stats', NEW.match_id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exchange_stats ON exchanges;
CREATE TRIGGER trg_exchange_stats
  AFTER INSERT OR UPDATE OF voided ON exchanges
  FOR EACH ROW
  EXECUTE FUNCTION trigger_refresh_exchange_stats();
