-- 0106_venue_lices.sql
--
-- Reusable per-venue lices (pistes) catalogue, parallel to venue_areas.
-- A tournament-capable venue can define its physical lices once; the event
-- wizard pre-fills an event's lices from the picked venue's catalogue (event
-- lices stay event-scoped in the `lices` table — these are the reusable
-- template). Access is org-admin via the service role + service-layer org
-- checks, mirroring venue_areas (no RLS, same as its sibling table).

CREATE TABLE IF NOT EXISTS venue_lices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id, name)
);

CREATE INDEX IF NOT EXISTS venue_lices_venue_idx ON venue_lices(venue_id);
