-- T-404: Enable Supabase Realtime on scoring tables.
--
-- Supabase Realtime bridges Postgres WAL changes to subscribed clients via
-- Phoenix Channels. Two things are required per table:
--   1. REPLICA IDENTITY FULL — UPDATE/DELETE events include the old row so
--      clients can identify which row changed (e.g. a voided exchange).
--   2. Added to the supabase_realtime publication — Realtime watches this
--      publication for row changes to broadcast.
--
-- RLS policies from 0002_rls.sql already restrict visibility: anonymous
-- subscribers only see rows from events with status IN
-- ('published','running','completed'). Supabase Realtime v2 evaluates RLS
-- per subscriber, so draft-event rows are never sent to unauthorised clients.
--
-- This migration is idempotent: re-running it on an already-configured DB
-- is a no-op.

-- Step 1: REPLICA IDENTITY FULL on all three tables.
-- FULL is safe here; the tables are write-heavy but not huge per match.
ALTER TABLE exchanges    REPLICA IDENTITY FULL;
ALTER TABLE matches      REPLICA IDENTITY FULL;
ALTER TABLE match_events REPLICA IDENTITY FULL;

-- Step 2: Ensure the supabase_realtime publication exists.
-- In a running self-hosted stack, supabase-realtime creates this publication
-- automatically. This guard handles the edge case where the migration runs
-- before Supabase services are fully initialised (e.g. fresh CI env).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

-- Step 3: Add tables to the publication (idempotent per table).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'exchanges'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE exchanges;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'matches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE matches;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'match_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE match_events;
  END IF;
END
$$;
