-- 0088_venues.sql
--
-- Introduce the Venue concept: an org-level catalogue of physical
-- locations that can be reused across many events of the same
-- organization.
--
-- Model:
--   - Venue belongs to an Organization.
--   - A venue can host tournaments, workshops, or both (flags).
--   - A venue may be split into Areas (for hosting several
--     concurrent workshops); 0 or 1 area means workshop sessions
--     link directly to the venue without picking an area.
--   - Lices (fighting strips) now live INSIDE a venue. The lice's
--     event_id stays as the primary scoping field; venue_id is the
--     new spatial pointer.
--   - workshop_sessions get venue_id + area_id. The legacy lice_id
--     column is dropped — no service or controller referenced it.

-- Org-level venue catalogue.
CREATE TABLE IF NOT EXISTS venues (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  address          TEXT,
  hosts_tournament BOOLEAN NOT NULL DEFAULT TRUE,
  hosts_workshop   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, name)
);
CREATE INDEX IF NOT EXISTS venues_org_idx ON venues(organization_id);

-- Optional sub-rooms inside a venue. When a venue has 0 or 1 area
-- defined, workshop_sessions link directly to the venue; multiple
-- areas means each session picks one.
CREATE TABLE IF NOT EXISTS venue_areas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id, name)
);
CREATE INDEX IF NOT EXISTS venue_areas_venue_idx ON venue_areas(venue_id);

-- Lices live inside a venue. event_id stays as the primary scoping
-- field so existing queries keep working; venue_id is the new
-- spatial pointer. Nullable for the bootstrap case (operators may
-- create a lice before linking it to a venue).
ALTER TABLE lices
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES venues(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS lices_venue_idx ON lices(venue_id);

-- Workshop sessions get venue + area pointers. The legacy lice_id
-- column is dropped — grep audit showed no service or controller
-- referenced it, only the schema definition. Venue + area is the
-- canonical workshop-space attribute.
ALTER TABLE workshop_sessions
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS area_id  UUID REFERENCES venue_areas(id) ON DELETE SET NULL,
  DROP COLUMN IF EXISTS lice_id;
CREATE INDEX IF NOT EXISTS workshop_sessions_venue_idx ON workshop_sessions(venue_id);
CREATE INDEX IF NOT EXISTS workshop_sessions_area_idx  ON workshop_sessions(area_id);

NOTIFY pgrst, 'reload schema';
