-- 0128: Replace mv_fighter_exchange_stats with an on-read, per-tournament function.
--
-- Why: the materialized view never actually refreshed on the scoring path. Its
-- trigger (trg_exchange_stats) only did pg_notify('refresh_exchange_stats', …) and
-- NOTHING in the codebase LISTENs on that channel, so the view was stale until one
-- of three rare explicit refreshes (admin endpoint, event test-flag flip, archive
-- restore). The public tournament stats page + organizer statistics dashboard
-- therefore rendered stale blow tables / ratios / doubles% next to LIVE pool
-- standings — a visible contradiction. (See the false "auto-refreshes via its
-- exchange trigger" comment removed from events.service.ts in this change.)
--
-- Also fixes a netting regression: 0110 netted afterblow points via
-- red_score_delta/blue_score_delta, but 0113 recreated the view from the 0010
-- baseline and silently reverted the point columns to raw values, so pointsGiven/
-- Received/pointRatio were wrong in deductive-afterblow tournaments.
--
-- Fix: drop the MV + its dead refresh apparatus and compute the same columns
-- on-read, scoped to one tournament, always fresh. Point columns net correctly for
-- BOTH afterblow modes and every exchange type by summing the stored per-fighter
-- deltas (computeDeltas already wrote them): own delta = points given, opponent
-- delta = points received. Blow-count columns are mode-independent and unchanged.
-- Mirrors the compact_fighter_stats RPC pattern (0114).

-- ── Remove the stale materialized view + its dead notify/refresh apparatus ────────
DROP MATERIALIZED VIEW IF EXISTS mv_fighter_exchange_stats CASCADE;
DROP TRIGGER  IF EXISTS trg_exchange_stats ON exchanges;
DROP FUNCTION IF EXISTS trigger_refresh_exchange_stats();
DROP FUNCTION IF EXISTS refresh_fighter_exchange_stats();

-- ── On-read per-tournament fighter exchange stats ────────────────────────────────
-- points_given/points_received are BIGINT: SUM(integer delta) is bigint and the
-- RETURNS TABLE types must match exactly or CREATE FUNCTION raises "structure of
-- query does not match function result type".
CREATE OR REPLACE FUNCTION fighter_exchange_stats(p_tournament_id UUID)
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
  hits_received_1 BIGINT,
  afterblow_received_1 BIGINT,
  hits_received_2 BIGINT,
  afterblow_received_2 BIGINT,
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
    JOIN matches     m  ON m.id  = e.match_id
    JOIN phases      ph ON ph.id = m.phase_id
    JOIN tournaments tt ON tt.id = ph.tournament_id
    JOIN events      ev ON ev.id = tt.event_id
    WHERE ph.tournament_id = p_tournament_id
      AND e.voided = false
      AND ev.is_test_event = false          -- preserve 0113 test-event exclusion
  ),
  per_registration AS (
    SELECT
      reg_id,

      -- ── Doubles ────────────────────────────────────────────────────────────────
      COUNT(*) FILTER (WHERE type = 'double') AS doubles,

      -- ── Clean hits GIVEN (attacker) ─────────────────────────────────────────────
      COUNT(*) FILTER (WHERE type = 'clean' AND attacker_reg_id = reg_id AND first_strike_value = 1) AS hits_given_1,
      COUNT(*) FILTER (WHERE type = 'clean' AND attacker_reg_id = reg_id AND first_strike_value = 2) AS hits_given_2,

      -- ── Afterblow GIVEN (attacker), categorised by the attacker's RAW strike ─────
      COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 1) AS afterblow_given_1,
      COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 2) AS afterblow_given_2,

      -- ── Clean hits RECEIVED (defender) ──────────────────────────────────────────
      COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 1) AS hits_received_1,
      COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 2) AS hits_received_2,

      -- ── Afterblow RECEIVED (defender), by the attacker's RAW strike (mode-indep) ─
      COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 1) AS afterblow_received_1,
      COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 2) AS afterblow_received_2,

      -- ── Points (scoring-based, mode-aware) ──────────────────────────────────────
      -- The stored per-exchange deltas already net the afterblow mode for every
      -- type (clean, afterblow deductive/full, double=0). own delta = given,
      -- opponent delta = received.
      COALESCE(SUM(CASE WHEN reg_id = red_registration_id THEN red_score_delta  ELSE blue_score_delta END), 0) AS points_given,
      COALESCE(SUM(CASE WHEN reg_id = red_registration_id THEN blue_score_delta ELSE red_score_delta  END), 0) AS points_received,

      -- ── Blow counts (mode-independent) ──────────────────────────────────────────
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
    pr.hits_received_1,
    pr.afterblow_received_1,
    pr.hits_received_2,
    pr.afterblow_received_2,
    pr.blows_given,
    (pr.clean_received + pr.afterblows_received_total) AS blows_received,
    pr.afterblows_received_total,
    pr.points_given,
    pr.points_received,
    (pr.hits_given_1 + pr.afterblow_given_1 + pr.hits_given_2 + pr.afterblow_given_2 +
     pr.hits_received_1 + pr.afterblow_received_1 + pr.hits_received_2 + pr.afterblow_received_2 +
     pr.doubles) AS total_exchanges,
    ROUND(pr.blows_given::numeric / NULLIF(pr.clean_received + pr.afterblows_received_total, 0), 3) AS hit_ratio,
    ROUND(pr.points_given::numeric / NULLIF(pr.points_received, 0), 3) AS point_ratio
  FROM per_registration pr
  JOIN registrations r ON r.id = pr.reg_id
  JOIN persons       p ON p.id = r.person_id
  LEFT JOIN clubs    c ON c.id = p.club_id
  ORDER BY hit_ratio DESC NULLS LAST;
$$;
