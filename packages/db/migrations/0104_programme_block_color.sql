-- 0104_programme_block_color.sql
--
-- Programme blocks (admin / break bars) get an optional color. The operator
-- picks a swatch when creating or editing a block; the schedule grid and the
-- planner render it as the bar tint, falling back to the per-kind default
-- when NULL. Stored as a "#rrggbb" string (nullable — existing rows keep the
-- kind default).

ALTER TABLE event_programme_blocks
  ADD COLUMN IF NOT EXISTS color_hex TEXT;

NOTIFY pgrst, 'reload schema';
