-- Test-event flag: organizers can mark an event as a test (dry-run) so they
-- can hard-delete it even with recorded results, and so its data never leaks
-- into public pages, personal spaces, or statistics.
--
-- (The mv_fighter_exchange_stats drop+recreate that used to live here was
-- removed in the migration-consolidation cleanup: 0128 replaced that MV with an
-- on-read function, so recreating it here was dead weight on a fresh replay.
-- The is_test_event column stays — 0128's fighter_exchange_stats() reads it.)

ALTER TABLE events ADD COLUMN IF NOT EXISTS is_test_event BOOLEAN NOT NULL DEFAULT FALSE;
