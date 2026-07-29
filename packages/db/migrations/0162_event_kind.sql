-- ─────────────────────────────────────────────────────────────────────────────
-- 0162 — events.event_kind: replace the is_test_event boolean with a 3-value kind
--
-- 0113 added events.is_test_event for dry-run events: hidden from public pages,
-- personal spaces and statistics, and hard-deletable even with recorded results.
-- That one boolean bundled two independent axes — visibility suppression and the
-- hard-delete override — which worked only while every non-standard event wanted
-- both.
--
-- "Club events" (club nights, gradings, friendly sparring) want the second
-- without the first: fully public and visible in personal spaces, but never
-- counted toward rankings, career statistics or HEMA Ratings, and still
-- disposable. A second boolean would admit an impossible `test AND club` row.
-- Three mutually exclusive kinds cannot, so the flag becomes an enum.
--
--   kind     | public + /me | stats | dashboard | ratings | announce | hard-delete
--   ---------|--------------|-------|-----------|---------|----------|------------
--   standard | yes          | yes   | counted   | yes     | yes      | no
--   test     | no           | no    | excluded  | no      | no       | yes
--   club     | yes          | no    | counted   | no      | no       | yes
--
-- Note the dashboard column: club events ARE counted on the super-admin platform
-- dashboard even though they are not counted in rankings. A club night is real
-- activity on the platform; a dry run is not. See countsAsPlatformActivity vs
-- countsTowardStats in packages/types/src/event-kind.ts — the two predicates
-- differ on purpose and must not be unified.
--
-- DELIBERATELY UNCHANGED — do not "fix" these:
--   • fighter_exchange_stats (0129) and tournament_target_value_stats (0135) are
--     kind-INCLUSIVE by design. A tournament's own stats page must reflect that
--     tournament whatever its kind, or a club event shows blank stats next to
--     live pool standings. Only cross-event aggregates drop non-standard kinds.
--
-- Statement order below is load-bearing:
--   • backfill before VALIDATE
--   • replace compact_fighter_stats before DROP COLUMN (its body reads the column)
--   • recreate the partial index before DROP COLUMN (the drop would take it along)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE events ADD COLUMN IF NOT EXISTS event_kind TEXT NOT NULL DEFAULT 'standard';

UPDATE events SET event_kind = 'test' WHERE COALESCE(is_test_event, FALSE) = TRUE;

ALTER TABLE events
  ADD CONSTRAINT events_event_kind_check
  CHECK (event_kind IN ('standard', 'test', 'club')) NOT VALID;

ALTER TABLE events VALIDATE CONSTRAINT events_event_kind_check;

COMMENT ON COLUMN events.event_kind IS
  'standard = real competition (public, rated, protected from hard delete); '
  'test = dry run (hidden everywhere, unrated, disposable); '
  'club = internal club activity (public and visible in /me, but unrated and '
  'disposable). Counted on the platform dashboard for standard and club, not '
  'for test. See packages/types/src/event-kind.ts for the predicates.';

-- ─────────────────────────────────────────────────────────────────────────────
-- compact_fighter_stats — group member cards (/me/groups).
--
-- Identical to 0138 except the kind gate: only STANDARD results count now, so
-- club events are excluded alongside test events. Signature is unchanged, so
-- CREATE OR REPLACE preserves grants and creates no overload ambiguity.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Public list index (0158). Dropped and recreated rather than CREATE IF NOT
-- EXISTS: the name already exists, so the IF NOT EXISTS form would silently
-- keep the old is_test_event predicate and the column drop would then take the
-- index with it.
--
-- The predicate is `event_kind <> 'test'` and the API emits a textually
-- identical `.neq('event_kind','test')`. Partial-index matching needs the query
-- clause to imply the index clause; identity guarantees that, and survives a
-- future 4th kind without silently dropping out of the index.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_events_status_start_date;

CREATE INDEX IF NOT EXISTS idx_events_status_start_date
  ON events (status, start_date DESC)
  WHERE event_kind <> 'test';

ALTER TABLE events DROP COLUMN IF EXISTS is_test_event;

NOTIFY pgrst, 'reload schema';
