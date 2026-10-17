-- 0223: an Event's dates are dates, a medal's year starts at 2000, and only the API writes medals
-- (the 2026-10-15 sweep, O6; operator rulings 2026-10-17 "real date column" and "medal year floor").
--
-- 1. `events.start_date` and `end_date` were TEXT (0001): "next Tuesday" or 2026-02-30 was stored as
--    given, and every reader that casts (`start_date::date`, 0077, 0210) would then fail. They become
--    DATE; PostgREST still answers "2026-05-03", so no reader changes. The end may not come before
--    the start: the API refuses it first, and this CHECK holds it against two writers that each move
--    one end.
-- 2. A medal's year: the API takes 2000 up to this year. A CHECK cannot read "this year" (it is not
--    immutable, and a restore would re-check old rows against a later year), so the table holds the
--    floor only (ruling "Floor only").
-- 3. `fighter_manual_medals_write` (0123) let the fighter (or a super admin) write their medals
--    through PostgREST, past the API's checks. Every medal write in apps/api goes through
--    `supabase.service` (fighters.service.ts), so the policy goes and the two public roles lose
--    INSERT, UPDATE and DELETE: a stray write fails loudly (42501), as in 0216.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table. Reads do not change: `fighter_manual_medals_select` stays (medals are public on the
-- fighter profile). `pnpm db:rls-probe` (check 5) tries each medal write as the seeded organisation
-- admin, and packages/db/test/event-dates-medal-writes.test.ts pins the statements.
--
-- No IF EXISTS anywhere: a mistyped name must fail the replay, not pass it.

ALTER TABLE events
  ALTER COLUMN start_date TYPE DATE USING start_date::date,
  ALTER COLUMN end_date TYPE DATE USING end_date::date;

ALTER TABLE events
  ADD CONSTRAINT events_end_not_before_start CHECK (end_date >= start_date);

ALTER TABLE fighter_manual_medals
  ADD CONSTRAINT fighter_manual_medals_year_floor CHECK (year >= 2000);

DROP POLICY "fighter_manual_medals_write" ON fighter_manual_medals;

REVOKE INSERT, UPDATE, DELETE ON fighter_manual_medals FROM anon, authenticated;
