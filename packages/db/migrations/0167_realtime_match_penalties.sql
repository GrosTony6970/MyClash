-- Enable Supabase Realtime on match_penalties.
--
-- 0004_realtime.sql set this up for exchanges / matches / match_events and
-- missed match_penalties, but `useLiveMatch` (the hook behind the public TV
-- display and the admin scoreboard preview) has always opened its channel with
-- FOUR postgres_changes bindings — including one on match_penalties.
--
-- That is not a partial outage. supabase-js compares the bindings it sent
-- against the ones the server accepted in the join reply, and on a count
-- mismatch it calls unsubscribe() and reports CHANNEL_ERROR — permanently,
-- with no rejoin. So the ENTIRE channel dies: the public per-lice display
-- never received a score, a clock transition or an exchange, and sat on
-- "RECONNECTING…" until someone reloaded the page by hand. Every other live
-- surface polls (admin display 1.5s, control room 7s, piste screen 20s), which
-- is why this only ever showed up on the one screen with no fallback.
--
-- Same two requirements as 0004:
--   1. REPLICA IDENTITY FULL — UPDATE/DELETE events carry the old row so a
--      client can tell WHICH card was voided.
--   2. Membership in the supabase_realtime publication.
--
-- Visibility is already correct: match_penalties_select (0016_penalties.sql)
-- lets anonymous subscribers read rows from events with status IN
-- ('published','running','completed'), matching the other three tables.
-- Realtime v2 evaluates RLS per subscriber, so draft-event cards stay private.
--
-- Idempotent: re-running on an already-configured DB is a no-op.

ALTER TABLE match_penalties REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'match_penalties'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE match_penalties;
  END IF;
END
$$;
