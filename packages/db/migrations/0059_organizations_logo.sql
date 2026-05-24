-- Migration 0059: organizations get a logo_url for the R4 of the
-- events-list overhaul.
--
-- Same shape as events.logo_url (added in 0058) and clubs.logo_url.
-- The image lives in the `event-assets` bucket under
-- `organizations/{orgId}/logo-{timestamp}.{ext}`. Set by
-- `OrganizationsService.uploadLogo`. Rendered in the organizer shell
-- brand block (top-left) when present, with the MyClash mini-logo as
-- the fallback.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS logo_url TEXT NULL;
