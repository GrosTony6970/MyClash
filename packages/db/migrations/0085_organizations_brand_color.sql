-- Migration 0085: organizations get a brand_color for the public landing
-- event-card accent.
--
-- Stored as a hex string (e.g. '#c0392b'); NULL means the public site
-- falls back to the MyClash primary color. Set from the admin org
-- settings page; rendered as a 4px left-edge stripe on each event card
-- on app.myclash.fr/ so spectators can see at a glance which
-- organisation runs each event.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS brand_color TEXT NULL;
