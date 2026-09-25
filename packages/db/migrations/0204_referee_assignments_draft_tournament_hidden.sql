-- 0204: a referee assignment in a draft Tournament is hidden from the public.
--
-- THE DEFECT. `referee_assignments_select` (0063) showed every assignment to anyone once its Event
-- was published. An assignment to a Pool or a bout belongs to a Tournament, and that Tournament's
-- status was never read: an organiser who staffed a draft Tournament's Pools under a published Event
-- published who referees where, with each row's `conflicts_jsonb`, to anyone reading through
-- PostgREST. 0200 and 0203 gated a Tournament's contents and row; the 0203 review (2026-09-25)
-- found this the only policy left with an Event-only public branch on Tournament-scoped rows.
--
-- WHAT CHANGES (operator ruling 126). The public branch still needs a published, running or completed
-- Event. A Pool- or bout-scoped assignment also needs its Tournament published, running or completed
-- (0200's rule). A piste-scoped one has no Tournament and keeps the Event-only rule. The CHECK
-- `referee_assignments_scope_check` guarantees each row carries exactly its scope's id. The referee's own
-- rows and the club's members are unchanged. The probe seeds one assignment per scope and status.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table. One SELECT policy is replaced. The public loses the Pool and bout assignments of a
-- draft or archived Tournament; nothing in the apps reads this table as anon (the API uses the
-- service role, and no live channel subscribes to it).

DROP POLICY IF EXISTS "referee_assignments_select" ON referee_assignments;
CREATE POLICY "referee_assignments_select" ON referee_assignments FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM global_persons gp
      WHERE gp.id = referee_assignments.person_id
        AND gp.claimed_by_user_id = auth.uid()
    )
    OR is_org_member(event_org_id(event_id))
    OR (
      EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = referee_assignments.event_id
          AND e.status IN ('published','running','completed')
      )
      AND (
        referee_assignments.scope_type = 'lice'
        OR EXISTS (
          SELECT 1 FROM pools p
          JOIN phases ph ON ph.id = p.phase_id
          JOIN tournaments t ON t.id = ph.tournament_id
          WHERE p.id = referee_assignments.pool_id
            AND t.status IN ('published','running','completed')
        )
        OR EXISTS (
          SELECT 1 FROM matches m
          JOIN phases ph ON ph.id = m.phase_id
          JOIN tournaments t ON t.id = ph.tournament_id
          WHERE m.id = referee_assignments.match_id
            AND t.status IN ('published','running','completed')
        )
      )
    )
  );
