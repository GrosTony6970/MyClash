-- 0110: Net afterblow points in mv_fighter_exchange_stats from the stored
-- per-fighter deltas instead of the raw afterblow_value.
--
-- Background: exchanges now store the referee's RAW button values
-- (first_strike_value = attacker, afterblow_value = defender) so blow-count
-- stats stay faithful (e.g. ✗2-1 is categorised by the attacker's raw
-- first_strike_value). The afterblow MODE (full vs deductive) is applied when
-- scores are derived, and the netted per-fighter result is materialised on
-- red_score_delta / blue_score_delta.
--
-- Therefore the POINT columns must read the netted deltas, not the raw afterblow
-- values: in deductive mode a 2-1 afterblow stores first_strike_value=2,
-- afterblow_value=1 but nets attacker +1 / defender 0.
--
--   Blow counts  → raw first_strike_value / type   (unchanged, mode-independent)
--   Point sums   → red_score_delta / blue_score_delta (netted)
--
-- Clean hits are not afterblow-mode affected, so their point columns keep using
-- first_strike_value. Only the afterblow branches change.

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
    e.red_score_delta,
    e.blue_score_delta,
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
    -- Blow count by the attacker's RAW first_strike_value (1pt or 2pt attack).
    COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 1) AS afterblow_given_1,
    COUNT(*) FILTER (WHERE type = 'afterblow' AND attacker_reg_id = reg_id AND first_strike_value = 2) AS afterblow_given_2,

    -- ── Clean hits RECEIVED (defender in a clean exchange) ────────────────────
    COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 1) AS hits_received_1,
    COUNT(*) FILTER (WHERE type = 'clean' AND defender_reg_id = reg_id AND first_strike_value = 2) AS hits_received_2,

    -- ── Afterblow RECEIVED (defender in an afterblow exchange) ────────────────
    -- CRITICAL: counted by exchange TYPE and the attacker's RAW first_strike_value,
    -- NOT by points. The defender landed the blow regardless of mode, and the
    -- category (✗1-1 / ✗2-1) is the attacker's raw strike that triggered it.
    COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 1) AS afterblow_received_1,
    COUNT(*) FILTER (WHERE type = 'afterblow' AND defender_reg_id = reg_id AND first_strike_value = 2) AS afterblow_received_2,

    -- ── Points GIVEN (scoring-based, mode-aware) ──────────────────────────────
    -- Clean: raw first_strike_value (not afterblow-mode affected). Afterblow:
    -- the attacker's NETTED delta (deductive subtracts the afterblow).
    COALESCE(SUM(
      CASE
        WHEN type = 'clean'     AND attacker_reg_id = reg_id THEN first_strike_value
        WHEN type = 'afterblow' AND attacker_reg_id = reg_id THEN
          CASE WHEN reg_id = red_registration_id THEN red_score_delta ELSE blue_score_delta END
        ELSE 0
      END
    ), 0) AS points_given,

    -- ── Points RECEIVED (scoring-based, mode-aware) ───────────────────────────
    -- Clean: the attacker's points conceded (raw first_strike_value). Afterblow:
    -- the afterblow-lander's NETTED delta (0 in deductive mode).
    COALESCE(SUM(
      CASE
        WHEN type = 'clean'     AND defender_reg_id = reg_id THEN first_strike_value
        WHEN type = 'afterblow' AND defender_reg_id = reg_id THEN
          CASE WHEN reg_id = red_registration_id THEN red_score_delta ELSE blue_score_delta END
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

  -- ── Point-based columns (netted per afterblow mode) ──────────────────────
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

  -- ── Point ratio (POINT-based, netted per mode) ────────────────────────────
  ROUND(
    pr.points_given::numeric /
    NULLIF(pr.points_received, 0),
    3
  ) AS point_ratio

FROM per_registration pr
JOIN registrations r ON r.id  = pr.reg_id
JOIN persons       p ON p.id  = r.person_id
LEFT JOIN clubs    c ON c.id  = p.club_id;

-- ── Indexes (dropped with the MV above; recreate) ─────────────────────────────

CREATE UNIQUE INDEX mv_fighter_exchange_stats_pk
  ON mv_fighter_exchange_stats (tournament_id, registration_id);

CREATE INDEX mv_fighter_exchange_stats_tournament
  ON mv_fighter_exchange_stats (tournament_id);

-- The refresh function + exchange trigger from 0010 reference the view by name
-- and remain valid — no need to recreate them here.
