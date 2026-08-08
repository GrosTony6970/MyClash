-- 0172_staff_clock_skew.sql
--
-- Record how far a scoring tablet's clock is from the server's.
--
-- Every match clock is driven from the tablet: `clock_time_ms` on an exchange,
-- and the start/halt/resume transitions in `match_events`, are all stamped with
-- the tablet's own `Date.now()`. A tablet whose clock is wrong therefore does
-- not fail loudly — it produces bouts that look perfectly normal and are timed
-- wrong, and nothing downstream can tell, because the wrong number is the only
-- number there is.
--
-- The measurement is free: `useHeartbeat` already POSTs to /staff/heartbeat
-- every 20s while online. Adding the tablet's own clock to that payload lets
-- the server subtract it from its own receipt time. The result is stored beside
-- the other per-tablet health columns from 0149_live_board_columns.sql so the
-- Live board can render it with the outbox depth it already shows.
--
-- Signed on purpose: a tablet can be ahead (positive) or behind (negative), and
-- collapsing that to a magnitude would throw away the direction, which is what
-- tells you whether a bout was recorded as too long or too short.
--
-- NULL means "not measured yet", not "no skew" — a tablet that has never sent a
-- heartbeat carrying the field must not be rendered as a healthy zero.
--
-- One-way trip: the round-trip includes network latency, so a reading includes
-- up to a request's worth of transit and is not accurate to the millisecond.
-- It does not need to be. The failure it exists to catch is a tablet minutes or
-- hours out, typically a device that never joined wifi and kept a stale RTC.

ALTER TABLE event_staff_accounts
  ADD COLUMN IF NOT EXISTS clock_skew_ms INTEGER;

COMMENT ON COLUMN event_staff_accounts.clock_skew_ms IS
  'Signed ms the tablet clock is AHEAD of the server at last heartbeat. NULL = never measured.';

NOTIFY pgrst, 'reload schema';
