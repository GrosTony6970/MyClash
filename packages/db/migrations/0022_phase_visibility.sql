-- MyClash - Pool and bracket visibility publishing

ALTER TABLE phases
  ADD COLUMN IF NOT EXISTS visibility_status TEXT NOT NULL DEFAULT 'hidden',
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by_user_id UUID;

ALTER TABLE phases
  DROP CONSTRAINT IF EXISTS phases_visibility_status_check;

ALTER TABLE phases
  ADD CONSTRAINT phases_visibility_status_check
  CHECK (visibility_status IN ('hidden', 'published'));

-- Existing generated phases predate this feature and may already be visible in production.
UPDATE phases
SET visibility_status = 'published',
    published_at = COALESCE(published_at, created_at)
WHERE visibility_status = 'hidden';

CREATE INDEX IF NOT EXISTS phases_tournament_type_visibility_idx
  ON phases (tournament_id, type, visibility_status);

ALTER TABLE event_broadcast_notifications
  DROP CONSTRAINT IF EXISTS event_broadcast_target_type_check;

ALTER TABLE event_broadcast_notifications
  ADD CONSTRAINT event_broadcast_target_type_check CHECK (
    target_type IN ('all','fighters','referees','fighters_and_referees','specific_persons')
  );

DROP POLICY IF EXISTS "phases_select" ON phases;
DROP POLICY IF EXISTS "pools_select" ON pools;
DROP POLICY IF EXISTS "pool_members_select" ON pool_members;
DROP POLICY IF EXISTS "bracket_slots_select" ON bracket_slots;
DROP POLICY IF EXISTS "matches_select" ON matches;
DROP POLICY IF EXISTS "match_events_select" ON match_events;
DROP POLICY IF EXISTS "exchanges_select" ON exchanges;

CREATE POLICY "phases_select" ON phases FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM tournaments t
      JOIN events e ON e.id = t.event_id
      WHERE t.id = phases.tournament_id
        AND (
          is_org_member(e.organization_id)
          OR (e.status IN ('published','running','completed') AND phases.visibility_status = 'published')
        )
    )
  );

CREATE POLICY "pools_select" ON pools FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = pools.phase_id
        AND (
          is_org_member(e.organization_id)
          OR (e.status IN ('published','running','completed') AND ph.visibility_status = 'published')
        )
    )
  );

CREATE POLICY "pool_members_select" ON pool_members FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM pools p
      JOIN phases ph ON ph.id = p.phase_id
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE p.id = pool_members.pool_id
        AND (
          is_org_member(e.organization_id)
          OR (e.status IN ('published','running','completed') AND ph.visibility_status = 'published')
        )
    )
  );

CREATE POLICY "bracket_slots_select" ON bracket_slots FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = bracket_slots.phase_id
        AND (
          is_org_member(e.organization_id)
          OR (e.status IN ('published','running','completed') AND ph.visibility_status = 'published')
        )
    )
  );

CREATE POLICY "matches_select" ON matches FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = matches.phase_id
        AND (
          is_org_member(e.organization_id)
          OR (e.status IN ('published','running','completed') AND ph.visibility_status = 'published')
        )
    )
  );

CREATE POLICY "match_events_select" ON match_events FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM matches m
      JOIN phases ph ON ph.id = m.phase_id
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE m.id = match_events.match_id
        AND (
          is_org_member(e.organization_id)
          OR (e.status IN ('published','running','completed') AND ph.visibility_status = 'published')
        )
    )
  );

CREATE POLICY "exchanges_select" ON exchanges FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM matches m
      JOIN phases ph ON ph.id = m.phase_id
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE m.id = exchanges.match_id
        AND (
          is_org_member(e.organization_id)
          OR (e.status IN ('published','running','completed') AND ph.visibility_status = 'published')
        )
    )
  );
