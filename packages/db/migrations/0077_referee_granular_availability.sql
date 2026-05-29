-- Granular per-tournament + per-day referee availability.
--
-- Today, event_referees has two booleans (available_all_tournaments,
-- available_all_event_duration) — too coarse for operators who run
-- multi-tournament multi-day events. Slice 8 introduces two join tables
-- so each referee can be allowlisted per tournament AND per day.
--
-- Backwards-compat: the boolean columns stay. The read path treats them
-- as derived shortcuts — "all_tournaments = true" iff the allowlist
-- contains every tournament currently on the event, same for days.
-- Default seed below preserves today's "available for everything"
-- behaviour for every existing event_referees row.

-- IF NOT EXISTS so that re-running after the prod failure on the
-- backfill step (deploy aborted at the `event_referee_days` INSERT
-- below because `events.start_date` is TEXT, not date) doesn't choke
-- on the already-created tables / indexes from the rolled-back attempt.

CREATE TABLE IF NOT EXISTS event_referee_tournaments (
  event_id      uuid    NOT NULL,
  person_id     uuid    NOT NULL,
  tournament_id uuid    NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, person_id, tournament_id),
  FOREIGN KEY (event_id, person_id)
    REFERENCES event_referees(event_id, person_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS event_referee_tournaments_event_idx
  ON event_referee_tournaments (event_id);

CREATE TABLE IF NOT EXISTS event_referee_days (
  event_id   uuid     NOT NULL,
  person_id  uuid     NOT NULL,
  day_index  smallint NOT NULL CHECK (day_index >= 0),
  PRIMARY KEY (event_id, person_id, day_index),
  FOREIGN KEY (event_id, person_id)
    REFERENCES event_referees(event_id, person_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS event_referee_days_event_idx
  ON event_referee_days (event_id);

-- ── Backfill ─────────────────────────────────────────────────────────────────
--
-- Every event_referees row with available_all_tournaments = true gets one
-- allowlist row per tournament currently on the event. False stays empty
-- (current "no restriction" semantics happen to map to "all" — anyone who
-- explicitly set false was effectively unable to be assigned anyway, so
-- empty preserves that no-op state).

INSERT INTO event_referee_tournaments (event_id, person_id, tournament_id)
SELECT er.event_id, er.person_id, t.id
FROM event_referees er
JOIN tournaments t ON t.event_id = er.event_id
WHERE er.available_all_tournaments = true
ON CONFLICT DO NOTHING;

-- Same for days. day_index = 0..N-1 inclusive, where N = days between
-- events.start_date and events.end_date (or 1 when end_date is null).
-- generate_series gives us the indices straight.
--
-- events.start_date and events.end_date are TEXT columns (per 0001_init),
-- so the subtraction needs explicit ::date casts — the date-minus-date
-- operator returns the day delta as an integer directly. The COALESCE
-- guards against the schema's NOT NULL drifting to nullable in a later
-- migration; today end_date is NOT NULL, so the fallback is dead code.

INSERT INTO event_referee_days (event_id, person_id, day_index)
SELECT
  er.event_id,
  er.person_id,
  gs.day_index
FROM event_referees er
JOIN events e ON e.id = er.event_id
CROSS JOIN LATERAL generate_series(
  0,
  GREATEST(
    0,
    COALESCE(e.end_date, e.start_date)::date - e.start_date::date
  )
) AS gs(day_index)
WHERE er.available_all_event_duration = true
ON CONFLICT DO NOTHING;
