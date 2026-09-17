-- 0198: a referee duty stores no time of its own.
--
-- THE DEFECT. The referee board wrote each duty's start and end into
-- `referee_assignments.starts_at` / `ends_at` when the organiser saved or auto-assigned
-- (the start of the Pool's first bout, the planned end of its last). Nothing updated the
-- copy afterwards, so it went stale the moment a bout moved or the planner's bout length
-- changed. The public schedule, "my events" and both referee reminders read it back, so
-- they could show a time the grid no longer showed (ADR-017, "the frozen copy goes").
--
-- WHAT CHANGES. The two columns go. Every reader works the time out from the Matches the
-- duty covers: a duty on one Match is that Match's planned window; a duty on a Pool runs
-- from the Pool's first placed Match to the planned end of its last (the hull). No
-- backfill: the values were derived, so nothing is lost.
--
-- Workshop sessions carry columns of the same names; they are real times and stay.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table and no policy change. No view, function, trigger, policy, index or
-- constraint names either column (swept 0001–0197), so the drop cascades to nothing.

ALTER TABLE referee_assignments
  DROP COLUMN IF EXISTS starts_at,
  DROP COLUMN IF EXISTS ends_at;

NOTIFY pgrst, 'reload schema';
