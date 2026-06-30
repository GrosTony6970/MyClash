-- Test-event flag: organizers can mark an event as a test (dry-run) so they
-- can hard-delete it even with recorded results, and so its data never leaks
-- into public pages, personal spaces, or statistics.
--
-- This migration adds the column and recreates mv_fighter_exchange_stats
-- (originally 0010_stats_views.sql) so the materialized fighter stats exclude
-- test events. The refresh function + trigger from 0010 are unchanged (they
-- resolve the view by name at call time).

ALTER TABLE events ADD COLUMN IF NOT EXISTS is_test_event BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Recreate mv_fighter_exchange_stats excluding test events ──────────────────
DROP MATERIALIZED VIEW IF EXISTS mv_fighter_exchange_stats;

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
  JOIN matches     m  ON m.id  = e.match_id
  JOIN phases      ph ON ph.id = m.phase_id
  -- Exclude test events from materialized fighter stats.
  JOIN tournaments tt ON tt.id = ph.tournament_id
  JOIN events      ev ON ev.id = tt.event_id
  WHERE e.voided = false
    AND ev.is_test_event = false
),
per_registration AS (
  SELECT
    tournament_id,
    reg_id,

    -- ── Doubles ──────────────────────────────────────────────────────────────
    COUNT(*) FILTER (WHERE type = 'double') AS doubles,

    -- ── Clean hits GIVEN (attacker) ───────────────────────────────────────────
    COUNT(*) FILTER (WHERE type = 'clean' AND attacker_reg_id = reg_id AND first_strike_value = 1) AS hits_given_1,
    COUNT(*) FILTER (WHERE type = 'clean' AND attacker_reg_id = reg_id AND first_strike_value = 2) AS hits_given_2,

    -- ── Afterblow GIVEN (attacker in an afterblow exchange) ───────────────────
    COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 1) AS afterblow_given_1,
    COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 2) AS afterblow_given_2,

    -- ── Clean hits RECEIVED (defender in a clean exchange) ────────────────────
    COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 1) AS hits_received_1,
    COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 2) AS hits_received_2,

    -- ── Afterblow RECEIVED (defender in an afterblow exchange) ────────────────
    COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 1) AS afterblow_received_1,
    COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 2) AS afterblow_received_2,

    -- ── Points GIVEN (for scoring-based metrics) ──────────────────────────────
    COALESCE(SUM(
      CASE
        WHEN type = 'clean'     AND attacker_reg_id = reg_id THEN first_strike_value
        WHEN type = 'afterblow' AND attacker_reg_id = reg_id THEN first_strike_value
        ELSE 0
      END
    ), 0) AS points_given,

    -- ── Points RECEIVED (for scoring-based metrics) ───────────────────────────
    COALESCE(SUM(
      CASE
        WHEN type = 'clean'     AND defender_reg_id = reg_id THEN first_strike_value
        WHEN type = 'afterblow' AND defender_reg_id = reg_id THEN COALESCE(afterblow_value, 0)
        ELSE 0
      END
    ), 0) AS points_received,

    -- ── Blow count GIVEN (blow-based metrics, mode-independent) ───────────────
    COUNT(*) FILTER (WHERE type IN ('clean', 'afterblow') AND attacker_reg_id = reg_id) AS blows_given,

    -- ── Blow count RECEIVED (blow-based metrics, mode-independent) ────────────
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

-- ── Indexes (unique pk required for REFRESH … CONCURRENTLY) ────────────────────
CREATE UNIQUE INDEX mv_fighter_exchange_stats_pk
  ON mv_fighter_exchange_stats (tournament_id, registration_id);

CREATE INDEX mv_fighter_exchange_stats_tournament
  ON mv_fighter_exchange_stats (tournament_id);
