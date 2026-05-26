-- Migration 0064: tournaments get a logo_url so organisers can override
-- the parent event's branding for a single tournament inside an event.
--
-- Same shape and storage convention as 0058 (events.logo_url) and 0059
-- (organizations.logo_url). The image lives in the `event-assets`
-- bucket under `tournaments/{tournamentId}/logo-{timestamp}.{ext}` and
-- is set by `TournamentsService.uploadLogo`. Consumers (public
-- tournament page, bracket header, schedule grid) fall back to the
-- parent event's logo when this is null.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS logo_url TEXT NULL;
