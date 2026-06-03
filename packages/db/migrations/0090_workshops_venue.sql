-- 0090_workshops_venue.sql
--
-- workshops.venue_id — the workshop's default venue. Sessions of a
-- workshop pre-fill their own venue_id from this column at creation
-- time; the operator can still override per session via the
-- session-level Venue picker.
--
-- ON DELETE SET NULL because dropping a venue should not cascade to
-- wiping the workshop definition — the operator can repoint to a new
-- venue without losing schedule/roster data.

ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES venues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workshops_venue_idx ON workshops(venue_id);

NOTIFY pgrst, 'reload schema';
