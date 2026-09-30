-- ─────────────────────────────────────────────────────────────────────────────
-- 0214 — the "My groups" card stats count public Tournaments of public Events
-- only (ruling 163: a page that spans many Events shows public things only, for
-- everyone, a member of the draft's club included).
--
-- THE DEFECT. `compact_fighter_stats` (0192) filtered on `event_kind` alone. A
-- completed bout of a draft Tournament counted in `matches`, `wins` and
-- `losses` on every viewer's member card, and an Event whose only entry was in a
-- draft Tournament counted in `events_attended` once the Event completed. The
-- card told of the draft entry.
--
-- WHAT CHANGES. `regs` keeps only an entry in a Tournament that is published,
-- running or completed (the API's `PUBLIC_TOURNAMENT_STATUSES`), of a standard
-- Event that is not a draft. The Event rule mirrors `isPublicEvent`
-- (event-read-gate.ts): only `draft` is hidden, and an ARCHIVED Event stays
-- public on purpose, so its fighters keep their past results. A NULL status is
-- excluded by the `<>` itself: it fails closed. Everything downstream (bouts,
-- wins, losses, attended Events) reads `regs`, so it follows.
--
-- Identical to 0192 apart from the two conditions, including its `'max_doubles'`
-- literal, whose owner is `isDoubleLossBout` in @myclash/rules. Signature
-- unchanged, so CREATE OR REPLACE preserves the grants and creates no overload
-- ambiguity.
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
      AND e.status <> 'draft'
      AND t.status IN ('published', 'running', 'completed')
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
