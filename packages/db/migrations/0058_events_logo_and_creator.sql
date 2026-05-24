-- Migration 0058: events get a logo_url + created_by_user_id for the
-- organizer-facing Events List page (R1 of the events-list overhaul).
--
-- `logo_url` mirrors the same pattern used by `clubs.logo_url` (added in an
-- earlier migration). The image itself is stored in the `event-assets`
-- bucket under `events/{eventId}/logo-{timestamp}.{ext}` by
-- `EventsService.uploadLogo` (see apps/api/src/modules/events/events.service.ts).
--
-- `created_by_user_id` is the user who created the event — surfaced in
-- the events list "Created by" column. Nullable + un-FK'd to auth.users
-- because Supabase's auth schema lives outside our migration set and the
-- rest of the codebase uses the same pattern (e.g. audit_log.actor_user_id).
-- Existing rows are not back-filled; they show "—" in the Created-by column
-- until they're recreated. New rows are stamped by EventsService.createEvent.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS logo_url           TEXT NULL,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID NULL;

CREATE INDEX IF NOT EXISTS events_created_by_user_id_idx
  ON events (created_by_user_id) WHERE created_by_user_id IS NOT NULL;
