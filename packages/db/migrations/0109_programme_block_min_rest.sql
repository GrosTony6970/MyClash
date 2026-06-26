-- 0109_programme_block_min_rest.sql
--
-- Competition programme blocks get a configurable per-fighter minimum rest.
-- The match scheduler already honours `minRestMinutes` (it waits before
-- re-scheduling a fighter who just fought), but nothing ever passed a value,
-- so it was effectively hardcoded to the engine default of 10 minutes. This
-- surfaces it alongside match_gap_seconds / match_duration_minutes — a
-- block-level field the operator edits in the schedule planner. Existing rows
-- backfill to 10 (the prior effective default), so behaviour is unchanged
-- until an operator lowers it.

ALTER TABLE event_programme_blocks
  ADD COLUMN IF NOT EXISTS min_rest_minutes INTEGER NOT NULL DEFAULT 10;

NOTIFY pgrst, 'reload schema';
