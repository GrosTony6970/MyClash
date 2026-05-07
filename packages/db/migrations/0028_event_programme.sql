-- Migration 0028: Event programme blocks + workshop duration field

-- Add optional duration to workshops
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

-- Make workshop session times optional (filled by programme generator)
ALTER TABLE workshop_sessions ALTER COLUMN starts_at DROP NOT NULL;
ALTER TABLE workshop_sessions ALTER COLUMN ends_at DROP NOT NULL;

-- Event programme blocks
CREATE TABLE IF NOT EXISTS event_programme_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  block_type TEXT NOT NULL CHECK (block_type IN ('admin', 'competition', 'workshop', 'break')),
  label TEXT NOT NULL,
  competition_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
  competition_phase TEXT CHECK (competition_phase IN ('pool', 'bracket', 'finals')),
  workshop_id UUID REFERENCES workshops(id) ON DELETE SET NULL,
  lice_count INTEGER NOT NULL DEFAULT 1,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  match_gap_seconds INTEGER NOT NULL DEFAULT 15,
  match_duration_minutes INTEGER NOT NULL DEFAULT 5,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_epb_event ON event_programme_blocks(event_id);
CREATE INDEX IF NOT EXISTS idx_epb_event_day ON event_programme_blocks(event_id, day_index, sort_order);

ALTER TABLE event_programme_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "epb_read" ON event_programme_blocks FOR SELECT USING (
  event_id IN (
    SELECT id FROM events WHERE organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
);

CREATE POLICY "epb_write" ON event_programme_blocks FOR ALL USING (
  event_id IN (
    SELECT id FROM events WHERE organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')
    )
  )
);
