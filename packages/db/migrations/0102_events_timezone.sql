-- 0102_events_timezone.sql
--
-- Events get an IANA timezone. Workshop/match wall-clock times are entered
-- and displayed in this zone (converted to/from the UTC instants stored in
-- TIMESTAMPTZ columns) so an organizer whose browser timezone differs from
-- the event location no longer schedules or reads the wrong hour.
--
-- Default 'Europe/Paris' (the platform's FR-leaning HEMA context); the
-- organizer can change it from the event settings page.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/Paris';

NOTIFY pgrst, 'reload schema';
