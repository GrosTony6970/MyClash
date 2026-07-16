-- ─────────────────────────────────────────────────────────────────────────────
-- 0138 — compact_fighter_stats: count a match as soon as the MATCH is completed
--
-- 0114 required the fighter's TOURNAMENT to be status='completed' before any of
-- their matches counted. Nothing ever sets that: the status ticker transitions
-- events only, tournaments.status defaults to 'draft' with no CHECK constraint,
-- and only a manual organiser PATCH flips it to 'completed'. So a fully played
-- tournament left at 'published' reported 0 matches / 0 wins / 0 losses — the
-- fighter's own penalty cards showed while every combat stat read zero.
--
-- Now mirrors buildFighterCareer (fighter-career.ts) after the same fix:
--   • a match counts when matches.status='completed' — the tournament's own
--     status is irrelevant, so stats are live during an event
--   • win  = matches.winner_registration_id = the fighter's registration
--   • loss = winner set AND not the fighter's registration (null winner = draw)
--   • events_attended = distinct events either status='completed' OR where the
--     fighter fought a completed match
--   • test-event results still never count (events.is_test_event)
-- Registration→fighter identity flows through person_id → persons.global_person_id
-- (registrations carries no global person id; legacy fighter_id dropped in 0083).
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
      AND COALESCE(e.is_test_event, FALSE) = FALSE
  ),
  match_rows AS (
    SELECT
      rg.gp,
      rg.reg_id,
      (m.winner_registration_id = rg.reg_id) AS won,
      (m.winner_registration_id IS NOT NULL AND m.winner_registration_id <> rg.reg_id) AS lost
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
