-- T-1001: Materialized views for fighter exchange stats
-- Produces all columns from the lyonamhe.fr stats table:
-- Dbl, ✓1, ✓1-1, ✓2, ✓2-1, ✗1, ✗1-1, ✗2, ✗2-1, Total, Ratio

-- ── Enable pg_trgm if not already ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Materialized view: fighter exchange stats per tournament ──────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_fighter_exchange_stats AS
WITH exchange_data AS (
  SELECT
    m.phase_id,
    ph.tournament_id,
    e.id AS exchange_id,
    e.type,
    e.first_striker_color,
    e.first_strike_value,
    e.afterblow_value,
    e.voided,
    m.red_registration_id,
    m.blue_registration_id,
    -- Determine which registration is the "attacker" and "defender"
    CASE
      WHEN e.first_striker_color = 'red' THEN m.red_registration_id
      WHEN e.first_striker_color = 'blue' THEN m.blue_registration_id
      ELSE NULL
    END AS attacker_reg_id,
    CASE
      WHEN e.first_striker_color = 'red' THEN m.blue_registration_id
      WHEN e.first_striker_color = 'blue' THEN m.red_registration_id
      ELSE NULL
    END AS defender_reg_id
  FROM exchanges e
  JOIN matches m ON m.id = e.match_id
  JOIN phases ph ON ph.id = m.phase_id
  WHERE e.voided = false
),
per_registration AS (
  -- Aggregate stats per registration (fighter in a tournament)
  SELECT
    tournament_id,
    reg_id,
    -- Doubles
    COUNT(*) FILTER (WHERE type = 'double') AS doubles,
    -- Clean hits given (✓1 = 1pt, ✓2 = 2pt)
    COUNT(*) FILTER (WHERE type = 'clean' AND attacker_reg_id = reg_id AND first_strike_value = 1) AS hits_given_1,
    COUNT(*) FILTER (WHERE type = 'clean' AND attacker_reg_id = reg_id AND first_strike_value = 2) AS hits_given_2,
    -- Afterblow given (✓1-1, ✓2-1)
    COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 1) AS afterblow_given_1,
    COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 2) AS afterblow_given_2,
    -- Clean hits received (✗1, ✗2)
    COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 1) AS hits_received_1,
    COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 2) AS hits_received_2,
    -- Afterblow received (✗1-1, ✗2-1)
    COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 1) AS afterblow_received_1,
    COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 2) AS afterblow_received_2
  FROM exchange_data
  CROSS JOIN LATERAL (
    VALUES (red_registration_id), (blue_registration_id)
  ) AS regs(reg_id)
  GROUP BY tournament_id, reg_id
)
SELECT
  pr.tournament_id,
  pr.reg_id AS registration_id,
  r.person_id,
  p.given_name,
  p.family_name,
  c.name AS club_name,
  pr.doubles,
  pr.hits_given_1,
  pr.afterblow_given_1,
  pr.hits_given_2,
  pr.afterblow_given_2,
  pr.hits_received_1,
  pr.afterblow_received_1,
  pr.hits_received_2,
  pr.afterblow_received_2,
  -- Total exchanges involving this fighter
  (pr.hits_given_1 + pr.afterblow_given_1 + pr.hits_given_2 + pr.afterblow_given_2 +
   pr.hits_received_1 + pr.afterblow_received_1 + pr.hits_received_2 + pr.afterblow_received_2 +
   pr.doubles) AS total_exchanges,
  -- Ratio: hits given / (hits received + 1) — avoid division by zero
  ROUND(
    (pr.hits_given_1 + pr.afterblow_given_1 + pr.hits_given_2 * 2 + pr.afterblow_given_2 * 2)::numeric /
    NULLIF(pr.hits_received_1 + pr.afterblow_received_1 + pr.hits_received_2 * 2 + pr.afterblow_received_2 * 2, 0),
    3
  ) AS hit_ratio
FROM per_registration pr
JOIN registrations r ON r.id = pr.reg_id
JOIN persons p ON p.id = r.person_id
LEFT JOIN clubs c ON c.id = p.club_id;

-- Index for fast lookup by tournament
CREATE UNIQUE INDEX IF NOT EXISTS mv_fighter_exchange_stats_pk
  ON mv_fighter_exchange_stats (tournament_id, registration_id);

CREATE INDEX IF NOT EXISTS mv_fighter_exchange_stats_tournament
  ON mv_fighter_exchange_stats (tournament_id);

-- ── Refresh function (called by trigger + Redis-debounced job) ────────────────

CREATE OR REPLACE FUNCTION refresh_fighter_exchange_stats()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fighter_exchange_stats;
END;
$$;

-- ── Trigger: refresh after exchange insert/update/void ───────────────────────
-- Note: CONCURRENTLY refresh requires a unique index (created above).
-- In production, this is debounced via a Redis lock (1s) in the worker.
-- The trigger here is a fallback for dev/test environments.

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
