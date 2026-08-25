-- ─────────────────────────────────────────────────────────────────────────────
-- 0192 — a doubles-ceiling bout is a LOSS FOR BOTH in compact_fighter_stats.
--
-- The group member cards (/me/groups) derived `lost` from the winner alone:
--
--     (m.winner_registration_id IS NOT NULL AND m.winner_registration_id <> rg.reg_id)
--
-- A bout stopped by the doubles ceiling under `double_loss_zero_scores` has NO
-- winner, so it counted in `matches` and in NEITHER `wins` nor `losses` —
-- inflating the denominator of the win rate on the card while both fighters had
-- in fact lost it. The same ruling already held in Swiss standings and in the
-- HEMA Ratings export, and now holds in the pool standings too.
--
-- THE `'max_doubles'` LITERAL IS DUPLICATED HERE ON PURPOSE. Its owner is
-- `isDoubleLossBout` in @myclash/rules; SQL cannot import it. Only that one
-- reason means a double loss — `'max_doubles_draw'` IS a draw and
-- `'max_doubles_result_stands'` carries a real winner, so both are already
-- correct under the winner test and must NOT be added here.
--
-- Identical to 0162 apart from the `lost` expression. Signature unchanged, so
-- CREATE OR REPLACE preserves the grants and creates no overload ambiguity.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION compact_fighter_stats(p_ids UUID[])
RETURNS TABLE (
  global_person_id UUID,
  matches          INT,
  wins             INT,
  losses           INT,
  events_attended  INT
)
LANGUAGE sql STABLE
AS $$
  WITH regs AS (
    SELECT
      r.id                AS reg_id,
      pe.global_person_id AS gp,
      e.id                AS event_id,
      e.status            AS e_status
    FROM registrations r
    JOIN persons pe    ON pe.id = r.person_id
    JOIN tournaments t ON t.id = r.tournament_id
    JOIN events e      ON e.id = t.event_id
    WHERE pe.global_person_id = ANY(p_ids)
      AND e.event_kind = 'standard'
  ),
  match_rows AS (
    SELECT
      rg.gp,
      rg.reg_id,
      (m.winner_registration_id = rg.reg_id) AS won,
      (
        (m.winner_registration_id IS NOT NULL AND m.winner_registration_id <> rg.reg_id)
        OR m.end_reason = 'max_doubles'
      ) AS lost
    FROM regs rg
    JOIN matches m
      ON (m.red_registration_id = rg.reg_id OR m.blue_registration_id = rg.reg_id)
    WHERE m.status = 'completed'
  ),
  -- Registrations the fighter actually fought in — lets a still-open event count
  -- as attended once its matches are in the books.
  fought_regs AS (
    SELECT DISTINCT reg_id FROM match_rows
  )
  SELECT
    g.gp AS global_person_id,
    COALESCE(mm.matches, 0)::INT  AS matches,
    COALESCE(mm.wins, 0)::INT     AS wins,
    COALESCE(mm.losses, 0)::INT   AS losses,
    COALESCE(ev.events_attended, 0)::INT AS events_attended
  FROM (SELECT DISTINCT gp FROM regs) g
  LEFT JOIN (
    SELECT gp,
      COUNT(*)                     AS matches,
      COUNT(*) FILTER (WHERE won)  AS wins,
      COUNT(*) FILTER (WHERE lost) AS losses
    FROM match_rows
    GROUP BY gp
  ) mm ON mm.gp = g.gp
  LEFT JOIN (
    SELECT gp, COUNT(DISTINCT event_id) AS events_attended
    FROM regs
    WHERE e_status = 'completed'
       OR reg_id IN (SELECT reg_id FROM fought_regs)
    GROUP BY gp
  ) ev ON ev.gp = g.gp;
$$;
