-- 0210: a referee's availability is ticks only, on calendar dates, with one window per day
-- (W1.5, ADR-019, rulings 145-147).
--
-- 1. `event_referees.available_all_tournaments` / `available_all_event_duration` (0041) go
--    (ruling 145). The roster read them and the board did not, so the two disagreed: untick
--    Sunday, and the board refused the referee on Sunday while the roster still said "all days".
--    Now the rows alone say it: no row = available always, for a Tournament or a day added later.
--    Rows that tick every current option (0077's backfill, the old "all" link) are NOT folded to
--    none here: on a migrated stack those referees stay held to what existed then. The stack is
--    wiped and redeployed; the API folds such a write from now on.
-- 2. `event_referee_days.day_index` becomes `day date` (ruling 147). An index counted from
--    `events.start_date`, and moving the Event's dates never rewrote it, so "Sunday" silently
--    became another day. The backfill turns each index into the date it named at this moment;
--    `events.start_date` is TEXT (0001), hence the cast (0077 does the same). Rows that name a date
--    outside the Event stay: they never match a duty, and the roster shows them greyed.
-- 3. `from_minute` / `to_minute`: one from–to window per ticked day, minutes into the day on the
--    Event's clock (ruling 146). Both NULL = the whole day. A duty's whole hull must fit inside.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table. event_referee_days keeps RLS on with no policy (0141): only the API's service role
-- reads or writes it. packages/db/test/referee-availability-dates.test.ts pins the statements.
--
-- ── Archives ────────────────────────────────────────────────────────────────
--
-- An archive exported before this migration carries the dropped columns and `day_index`, and does
-- not restore (the 0208 / 0209 precedent: none exists in production, the stack is wiped and
-- redeployed).
--
-- No IF EXISTS anywhere: a mistyped name must fail the replay, not pass it.

ALTER TABLE event_referees
  DROP COLUMN available_all_tournaments,
  DROP COLUMN available_all_event_duration;

ALTER TABLE event_referee_days
  ADD COLUMN day date;

UPDATE event_referee_days d
SET day = e.start_date::date + d.day_index
FROM events e
WHERE e.id = d.event_id;

ALTER TABLE event_referee_days
  ALTER COLUMN day SET NOT NULL;

ALTER TABLE event_referee_days
  DROP CONSTRAINT event_referee_days_pkey;

ALTER TABLE event_referee_days
  DROP COLUMN day_index;

ALTER TABLE event_referee_days
  ADD CONSTRAINT event_referee_days_pkey PRIMARY KEY (event_id, person_id, day);

ALTER TABLE event_referee_days
  ADD COLUMN from_minute smallint,
  ADD COLUMN to_minute smallint;

ALTER TABLE event_referee_days
  ADD CONSTRAINT event_referee_days_window_check CHECK (
    (from_minute IS NULL AND to_minute IS NULL)
    OR (
      from_minute IS NOT NULL
      AND to_minute IS NOT NULL
      AND from_minute >= 0
      AND from_minute < to_minute
      AND to_minute <= 1440
    )
  );
