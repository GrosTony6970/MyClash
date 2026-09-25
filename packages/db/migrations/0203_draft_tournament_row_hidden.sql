-- 0203: a draft Tournament's own row, and its registrations, are hidden from the public.
--
-- THE DEFECT. `tournaments_select` (0002) showed a Tournament to anyone once its Event was
-- published, whatever the Tournament's own status. 0200 made ten policies on a Tournament's
-- contents read both statuses, but not the Tournament's row itself, nor `registrations_select`
-- (0002), which had the same Event-only branch. So a Tournament still in draft under a published
-- Event was readable through PostgREST by anyone: its name, and its registration rows (found on a
-- PG17 replay by the RLS probe, 2026-09-25).
--
-- WHAT CHANGES (operator ruling 119). Both public branches read the Event status AND the
-- Tournament status, both in published/running/completed: 0200's rule. The Tournament half is the
-- API's PUBLIC_TOURNAMENT_STATUSES; the Event half is RLS's own (the API also shows an archived
-- Event and hides a test one). The probe seeds a draft Tournament under the published Event.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table. Two SELECT policies are replaced; members of the Event's club and super admins keep
-- what they saw. The public loses the row and registrations of a draft or archived Tournament,
-- which the API already hid. A policy that reads `tournaments` in a subquery was always filtered by
-- this policy; the stricter status only matters to one that shows rows to non-members without
-- checking the Tournament status, and none does.

DROP POLICY IF EXISTS "tournaments_select" ON tournaments;
CREATE POLICY "tournaments_select" ON tournaments FOR SELECT
  USING (
    is_super_admin()
    OR is_org_member(event_org_id(event_id))
    OR (
      tournaments.status IN ('published','running','completed')
      AND EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = tournaments.event_id
          AND e.status IN ('published','running','completed')
      )
    )
  );

DROP POLICY IF EXISTS "registrations_select" ON registrations;
CREATE POLICY "registrations_select" ON registrations FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM tournaments t
      JOIN events e ON e.id = t.event_id
      WHERE t.id = registrations.tournament_id
        AND (
          is_org_member(e.organization_id)
          OR (e.status IN ('published','running','completed')
              AND t.status IN ('published','running','completed'))
        )
    )
  );
