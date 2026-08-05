-- 0169_lice_area.sql
--
-- Lices gain an optional area pointer.
--
-- 0088 gave venues an optional split into `venue_areas` and pointed
-- workshop_sessions at them, but lices only ever got `venue_id`. A
-- tournament that runs in parallel across two halls — or across two
-- named areas of one hall — had no way to say where a piste actually
-- stands, so the public display picker could only list bare names.
--
-- Same rule as 0088: a venue with 0 or 1 area means lices link to the
-- venue directly and leave `area_id` NULL. ON DELETE SET NULL so
-- retiring an area never cascades into the event's pistes.
--
-- `location_label` is left alone. It predates venues, no admin screen
-- has ever written it, and `area_id` supersedes it.

ALTER TABLE lices
  ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES venue_areas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS lices_area_idx ON lices(area_id);

NOTIFY pgrst, 'reload schema';
