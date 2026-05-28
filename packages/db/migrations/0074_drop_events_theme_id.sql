-- 0074_drop_events_theme_id.sql
--
-- The events.theme_id column has been vestigial since the original schema
-- (0001_init.sql:171). It was declared as plain UUID with no FK, no index,
-- and the inverse pointer themes.event_id NOT NULL REFERENCES events(id)
-- (0001_init.sql ~line 195) has always been the authoritative direction:
-- a theme belongs to exactly one event, found via
--   SELECT * FROM themes WHERE event_id = $event_id;
--
-- Carrying both pointers invites drift (which one wins when they disagree?)
-- and forces PostgREST to need a forward FK we never added. Audit confirms
-- only one consumer reads events.theme_id (archive.service.ts during
-- event-restore remapping) and that consumer's code is being updated in
-- the same change set to skip the column.
--
-- No DTO, no UI surface, no test fixture, and no event-creation path
-- writes events.theme_id. Safe to drop.

BEGIN;

ALTER TABLE events
  DROP COLUMN IF EXISTS theme_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
