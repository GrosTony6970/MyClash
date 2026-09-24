-- 0200: the Tournament status alone decides what the public sees of a Tournament.
--
-- THE DEFECT. Migration 0022 gave each phase its own `visibility_status`, and RLS showed the public a
-- phase's pools, bouts, exchanges and slots only when that flag said `published`. Generating Pools or
-- a bracket creates the phase `hidden`, and since the per-phase toggle left the organiser's pages
-- nothing in the app publishes it: only publishing the Tournament again did. So the Pools generated on
-- the day of a published Tournament were hidden from the live channel (realtime applies RLS) and from
-- the fighters' own schedules, while the public Tournament page and the API showed them. The same
-- policies never read the Tournament status, so a draft Tournament's bouts were hidden only through
-- that drifting flag, and a draft Tournament's penalties and Swiss rounds not at all.
--
-- WHAT CHANGES (operator ruling 91). Every public branch on a Tournament's contents reads the Event
-- status AND the Tournament status, both in published/running/completed: the Tournament rule the
-- public slug pages already apply. The phase flag is dropped with its two
-- stamps, so nothing can honour it again. Its index is replaced by the same index without the flag:
-- the phase lookups by Tournament and type still need it.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table. Ten SELECT policies are replaced; members of the Event's club and super admins keep
-- what they saw. For the public, a published Tournament's phases generated after publishing become
-- visible (the intent), and a draft Tournament's penalties and Swiss rounds become hidden (they were
-- visible through PostgREST as soon as the Event was published).

DROP POLICY IF EXISTS "phases_select" ON phases;
CREATE POLICY "phases_select" ON phases FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM tournaments t
      JOIN events e ON e.id = t.event_id
      WHERE t.id = phases.tournament_id
        AND (
          is_org_member(e.organization_id)
          OR (e.status IN ('published','running','completed')
              AND t.status IN ('published','running','completed'))
        )
    )
  );

DROP POLICY IF EXISTS "pools_select" ON pools;
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
          OR (e.status IN ('published','running','completed')
              AND t.status IN ('published','running','completed'))
        )
    )
  );

DROP POLICY IF EXISTS "pool_members_select" ON pool_members;
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
          OR (e.status IN ('published','running','completed')
              AND t.status IN ('published','running','completed'))
        )
    )
  );

DROP POLICY IF EXISTS "bracket_slots_select" ON bracket_slots;
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
          OR (e.status IN ('published','running','completed')
              AND t.status IN ('published','running','completed'))
        )
    )
  );

DROP POLICY IF EXISTS "matches_select" ON matches;
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
          OR (e.status IN ('published','running','completed')
              AND t.status IN ('published','running','completed'))
        )
    )
  );

DROP POLICY IF EXISTS "match_events_select" ON match_events;
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
          OR (e.status IN ('published','running','completed')
              AND t.status IN ('published','running','completed'))
        )
    )
  );

DROP POLICY IF EXISTS "exchanges_select" ON exchanges;
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
          OR (e.status IN ('published','running','completed')
              AND t.status IN ('published','running','completed'))
        )
    )
  );

DROP POLICY IF EXISTS "swiss_rounds_select" ON swiss_rounds;
CREATE POLICY "swiss_rounds_select" ON swiss_rounds FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = swiss_rounds.phase_id
        AND (
          is_org_member(e.organization_id)
          OR (e.status IN ('published','running','completed')
              AND t.status IN ('published','running','completed'))
        )
    )
  );

DROP POLICY IF EXISTS "swiss_entrants_select" ON swiss_entrants;
CREATE POLICY "swiss_entrants_select" ON swiss_entrants FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = swiss_entrants.phase_id
        AND (
          is_org_member(e.organization_id)
          OR (e.status IN ('published','running','completed')
              AND t.status IN ('published','running','completed'))
        )
    )
  );

DROP POLICY IF EXISTS "match_penalties_select" ON match_penalties;
CREATE POLICY "match_penalties_select" ON match_penalties FOR SELECT
  USING (
    is_org_member(match_penalty_event_org_id(match_id))
    OR EXISTS (
      SELECT 1
      FROM matches m
      JOIN phases p ON p.id = m.phase_id
      JOIN tournaments t ON t.id = p.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE m.id = match_id
        AND e.status IN ('published','running','completed')
        AND t.status IN ('published','running','completed')
    )
  );

DROP INDEX IF EXISTS phases_tournament_type_visibility_idx;
CREATE INDEX IF NOT EXISTS phases_tournament_type_idx ON phases (tournament_id, type);

ALTER TABLE phases
  DROP COLUMN IF EXISTS visibility_status,
  DROP COLUMN IF EXISTS published_at,
  DROP COLUMN IF EXISTS published_by_user_id;
