-- 0107_event_venues.sql
--
-- Explicit "this event spreads on these venues" link, for BOTH tournament and
-- workshop venues. Until now an event's venues were only derived from its lices
-- (lices.venue_id) and its workshop sessions (venue_id); this lets the event
-- edit modal manage venues directly (adding a tournament venue also seeds the
-- event's lices from the venue's lice catalogue). Admin-managed via the service
-- role + org checks, no RLS (mirrors venues / venue_areas / venue_lices).

CREATE TABLE IF NOT EXISTS event_venues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, venue_id)
);

CREATE INDEX IF NOT EXISTS event_venues_event_idx ON event_venues(event_id);
CREATE INDEX IF NOT EXISTS event_venues_venue_idx ON event_venues(venue_id);
