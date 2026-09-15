-- 0196: the bars carry no numbers; a Match may carry one override.
--
-- THE DEFECT. Each programme bar held its own bout length, gap and rest
-- (`match_duration_minutes`, `match_gap_seconds`, `min_rest_minutes`), next to the
-- Event's planner sheet (0195), which holds the same three numbers. Two places to type
-- one number: Generate spaced bouts from the bar's copy while Suggest sized the bar from
-- the sheet, and the two could disagree (ADR-018).
--
-- WHAT CHANGES. The three columns go. Generate and the re-fan read the sheet: each Match
-- takes the length for its kind (pool, swiss, elimination, finals) from its Tournament's
-- row on the sheet, else from the Event's, and the sheet's gap and rest.
--
-- `matches.planned_duration_override_minutes` is the one exception ADR-018 allows: a
-- length typed on a Pool's run in the grid's popover. Nullable, because a Match with no
-- override reads the sheet, and a NOT NULL DEFAULT would mint the length ADR-017
-- forbids. Above zero when set, because a zero-length window hides a clash rather than
-- showing one. Generate clears it on every Match it re-places.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table and no policy change. The new column sits on `matches` under its
-- existing row-level security.

ALTER TABLE event_programme_blocks
  DROP COLUMN IF EXISTS match_duration_minutes,
  DROP COLUMN IF EXISTS match_gap_seconds,
  DROP COLUMN IF EXISTS min_rest_minutes;

ALTER TABLE matches ADD COLUMN IF NOT EXISTS planned_duration_override_minutes INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'matches_planned_duration_override_positive'
  ) THEN
    ALTER TABLE matches
      ADD CONSTRAINT matches_planned_duration_override_positive
      CHECK (planned_duration_override_minutes IS NULL OR planned_duration_override_minutes > 0);
  END IF;
END $$;

COMMENT ON COLUMN matches.planned_duration_override_minutes IS
  'A length typed on this Match''s run, read instead of the planner sheet; null reads the sheet (ADR-018).';

NOTIFY pgrst, 'reload schema';
