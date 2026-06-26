-- 0108_tournament_phase_venues.sql
--
-- Per-phase-type venue assignment for tournaments that spread across venues
-- (e.g. pools at Hall A, bracket at Hall B). `phase_kind` uses the pool/bracket
-- taxonomy rather than phases.type because a tournament has at most one pool
-- phase and one bracket phase, AND the assignment must be able to exist before
-- any phase row does (phases are created lazily, at pool/bracket generation).
--
-- This stores INTENT. A match's actual venue is still derived via
-- matches.lice_id -> lices.venue_id; scheduling steers a phase's matches onto
-- lices at its assigned venue, and the admin surfaces which venue each phase
-- runs in. Admin-managed via the service role + org checks, no RLS (mirrors
-- venues / venue_areas / venue_lices / event_venues). venue_id is ON DELETE SET
-- NULL so deleting a venue clears the assignment rather than the tournament.

CREATE TABLE IF NOT EXISTS tournament_phase_venues (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  phase_kind    TEXT NOT NULL CHECK (phase_kind IN ('pool', 'bracket')),
  venue_id      UUID REFERENCES venues(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, phase_kind)
);

CREATE INDEX IF NOT EXISTS tournament_phase_venues_tournament_idx ON tournament_phase_venues(tournament_id);
CREATE INDEX IF NOT EXISTS tournament_phase_venues_venue_idx ON tournament_phase_venues(venue_id);

NOTIFY pgrst, 'reload schema';
