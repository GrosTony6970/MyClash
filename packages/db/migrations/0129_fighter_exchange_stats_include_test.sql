-- 0129: Per-tournament fighter stats must reflect THAT tournament — test or not.
--
-- Why: 0128 carried over 0113's `AND ev.is_test_event = false` filter into the
-- on-read fighter_exchange_stats(p_tournament_id) function. But that function is
-- strictly PER-TOURNAMENT and is consumed only by per-tournament surfaces (public
-- StatsController /tournaments/:id/stats/{overview,fighters} and the organizer
-- EventStatsService rollup). For a test event, the filter blanked the fighter
-- table / points / ratios / doubles% on that tournament's OWN stats page while
-- live pool standings rendered right next to it — the exact "visible contradiction"
-- 0128 set out to remove. An organizer flagging an event as a test to dry-run
-- scoring should still see its stats.
--
-- Safety: removing the filter here cannot leak test-event data into any cross-event
-- surface. Every platform-wide / public-profile / league / personal-space consumer
-- filters is_test_event INDEPENDENTLY at its own query layer and never calls this
-- function (admin-dashboard-stats via inner-embed counts, public fighter career via
-- compact_fighter_stats 0114, league rankings via league_tournament_results, public
-- event pages via events.getBySlug which 404s test events). This function's sole RPC
-- caller is StatsService.getFighterStats.
--
-- CREATE OR REPLACE keeps the identical signature (no DROP → grants preserved, no
-- overload ambiguity). The JOIN tournaments/JOIN events are now orphan (only the
-- is_test_event predicate used them; ph.tournament_id is the real scoping key), so
-- they are dropped. All other columns/logic are byte-identical to 0128.

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
