-- ============================================================
-- MyClash — RLS policies
-- Migration: 0002_rls.sql
-- Dep: 0001_init.sql
--
-- Strategy:
--   anon role        → SELECT only published events + public children
--   authenticated    → scoped by org membership (JWT claims)
--   super_admin      → bypasses all policies (auth.jwt() ->> 'role')
--   service_role     → bypasses RLS entirely (NestJS API server-side)
--
-- All mutations go through NestJS (service_role key) which enforces
-- application-level checks. RLS is the second line of defense.
-- ============================================================

-- ── Helper functions ──────────────────────────────────────────────────────────

-- Returns true if the current JWT has role = 'super_admin'
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() ->> 'role' = 'super_admin'
    OR
    EXISTS (
      SELECT 1 FROM platform_roles
      WHERE user_id = auth.uid()
        AND role = 'super_admin'
    ),
    FALSE
  );
$$;

-- Returns true if the current user is a member of the given organization
CREATE OR REPLACE FUNCTION is_org_member(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
  );
$$;

-- Returns true if the current user has at least the given role in the org
CREATE OR REPLACE FUNCTION has_org_role(org_id UUID, min_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND CASE min_role
        WHEN 'read_only'     THEN role IN ('read_only','scorekeeper','referee','workshop_lead','editor','admin','owner')
        WHEN 'scorekeeper'   THEN role IN ('scorekeeper','editor','admin','owner')
        WHEN 'editor'        THEN role IN ('editor','admin','owner')
        WHEN 'admin'         THEN role IN ('admin','owner')
        WHEN 'owner'         THEN role = 'owner'
        ELSE FALSE
      END
  );
$$;

-- Returns the organization_id for a given event
CREATE OR REPLACE FUNCTION event_org_id(ev_id UUID)
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT organization_id FROM events WHERE id = ev_id;
$$;

-- ── Enable RLS on all user-data tables ───────────────────────────────────────

ALTER TABLE organizations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_roles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE events                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE themes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lices                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE persons                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_privacy          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE phases                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pools                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bracket_slots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchanges               ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshops               ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_enrollments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_instructors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE referee_qualifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE referee_assignments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_assignment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE clubs                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fighters                ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruleset_submissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags           ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- ── organizations ─────────────────────────────────────────────────────────────

-- anon: no access
-- authenticated: see orgs they belong to
-- super_admin: see all
CREATE POLICY "orgs_select" ON organizations FOR SELECT
  USING (
    is_super_admin()
    OR is_org_member(id)
  );

CREATE POLICY "orgs_insert" ON organizations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "orgs_update" ON organizations FOR UPDATE
  USING (is_super_admin() OR has_org_role(id, 'owner'))
  WITH CHECK (is_super_admin() OR has_org_role(id, 'owner'));

CREATE POLICY "orgs_delete" ON organizations FOR DELETE
  USING (is_super_admin());

-- ── organization_members ──────────────────────────────────────────────────────

CREATE POLICY "org_members_select" ON organization_members FOR SELECT
  USING (
    is_super_admin()
    OR is_org_member(organization_id)
  );

CREATE POLICY "org_members_insert" ON organization_members FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR has_org_role(organization_id, 'admin')
  );

CREATE POLICY "org_members_update" ON organization_members FOR UPDATE
  USING (is_super_admin() OR has_org_role(organization_id, 'owner'));

CREATE POLICY "org_members_delete" ON organization_members FOR DELETE
  USING (is_super_admin() OR has_org_role(organization_id, 'owner'));

-- ── platform_roles ────────────────────────────────────────────────────────────

-- Only super_admin can read/write platform_roles
CREATE POLICY "platform_roles_select" ON platform_roles FOR SELECT
  USING (is_super_admin() OR user_id = auth.uid());

CREATE POLICY "platform_roles_insert" ON platform_roles FOR INSERT
  WITH CHECK (is_super_admin());

CREATE POLICY "platform_roles_delete" ON platform_roles FOR DELETE
  USING (is_super_admin());

-- ── events ────────────────────────────────────────────────────────────────────

-- anon: SELECT only published events
-- authenticated org member: SELECT all their org's events
-- admin+: INSERT/UPDATE/DELETE their org's events
CREATE POLICY "events_select_public" ON events FOR SELECT
  USING (
    status = 'published'
    OR status = 'running'
    OR status = 'completed'
    OR is_super_admin()
    OR is_org_member(organization_id)
  );

CREATE POLICY "events_insert" ON events FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR has_org_role(organization_id, 'admin')
  );

CREATE POLICY "events_update" ON events FOR UPDATE
  USING (is_super_admin() OR has_org_role(organization_id, 'admin'))
  WITH CHECK (is_super_admin() OR has_org_role(organization_id, 'admin'));

CREATE POLICY "events_delete" ON events FOR DELETE
  USING (is_super_admin() OR has_org_role(organization_id, 'owner'));

-- ── themes ────────────────────────────────────────────────────────────────────

CREATE POLICY "themes_select" ON themes FOR SELECT
  USING (
    is_super_admin()
    OR is_org_member(event_org_id(event_id))
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = themes.event_id
        AND e.status IN ('published','running','completed')
    )
  );

CREATE POLICY "themes_write" ON themes FOR ALL
  USING (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'))
  WITH CHECK (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'));

-- ── lices ─────────────────────────────────────────────────────────────────────

CREATE POLICY "lices_select" ON lices FOR SELECT
  USING (
    is_super_admin()
    OR is_org_member(event_org_id(event_id))
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = lices.event_id
        AND e.status IN ('published','running','completed')
    )
  );

CREATE POLICY "lices_write" ON lices FOR ALL
  USING (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'))
  WITH CHECK (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'));

-- ── clubs ─────────────────────────────────────────────────────────────────────

-- Clubs are public read; only org members can create/update
CREATE POLICY "clubs_select" ON clubs FOR SELECT USING (TRUE);

CREATE POLICY "clubs_insert" ON clubs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "clubs_update" ON clubs FOR UPDATE
  USING (is_super_admin() OR auth.uid() IS NOT NULL);

-- ── fighters ──────────────────────────────────────────────────────────────────

-- Fighters are public read; only the claiming user or super_admin can update
CREATE POLICY "fighters_select" ON fighters FOR SELECT USING (TRUE);

CREATE POLICY "fighters_insert" ON fighters FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "fighters_update" ON fighters FOR UPDATE
  USING (
    is_super_admin()
    OR claimed_by_user_id = auth.uid()
  );

-- ── persons ───────────────────────────────────────────────────────────────────

-- anon: no access (persons contain PII)
-- org member: full access to their event's persons
-- claimed user: can read their own person row
CREATE POLICY "persons_select" ON persons FOR SELECT
  USING (
    is_super_admin()
    OR is_org_member(event_org_id(event_id))
    OR claimed_by_user_id = auth.uid()
  );

CREATE POLICY "persons_insert" ON persons FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR has_org_role(event_org_id(event_id), 'editor')
  );

CREATE POLICY "persons_update" ON persons FOR UPDATE
  USING (
    is_super_admin()
    OR has_org_role(event_org_id(event_id), 'editor')
    OR claimed_by_user_id = auth.uid()
  );

CREATE POLICY "persons_delete" ON persons FOR DELETE
  USING (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'));

-- ── guest_sessions ────────────────────────────────────────────────────────────

-- Only the API (service_role) manages guest sessions
-- Authenticated users can see their own person's sessions
CREATE POLICY "guest_sessions_select" ON guest_sessions FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM persons p
      WHERE p.id = guest_sessions.person_id
        AND p.claimed_by_user_id = auth.uid()
    )
  );

-- ── follows ───────────────────────────────────────────────────────────────────

CREATE POLICY "follows_select" ON follows FOR SELECT
  USING (
    is_super_admin()
    OR follower_user_id = auth.uid()
  );

CREATE POLICY "follows_insert" ON follows FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND follower_user_id = auth.uid()
  );

CREATE POLICY "follows_delete" ON follows FOR DELETE
  USING (is_super_admin() OR follower_user_id = auth.uid());

-- ── person_privacy ────────────────────────────────────────────────────────────

CREATE POLICY "person_privacy_select" ON person_privacy FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM persons p
      WHERE p.id = person_privacy.person_id
        AND (
          p.claimed_by_user_id = auth.uid()
          OR is_org_member(event_org_id(p.event_id))
        )
    )
  );

CREATE POLICY "person_privacy_write" ON person_privacy FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM persons p
      WHERE p.id = person_privacy.person_id
        AND p.claimed_by_user_id = auth.uid()
    )
  );

-- ── tournaments ───────────────────────────────────────────────────────────────

CREATE POLICY "tournaments_select" ON tournaments FOR SELECT
  USING (
    is_super_admin()
    OR is_org_member(event_org_id(event_id))
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = tournaments.event_id
        AND e.status IN ('published','running','completed')
    )
  );

CREATE POLICY "tournaments_write" ON tournaments FOR ALL
  USING (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'))
  WITH CHECK (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'));

-- ── registrations ─────────────────────────────────────────────────────────────

CREATE POLICY "registrations_select" ON registrations FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM tournaments t
      JOIN events e ON e.id = t.event_id
      WHERE t.id = registrations.tournament_id
        AND (
          is_org_member(e.organization_id)
          OR e.status IN ('published','running','completed')
        )
    )
  );

CREATE POLICY "registrations_write" ON registrations FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM tournaments t
      JOIN events e ON e.id = t.event_id
      WHERE t.id = registrations.tournament_id
        AND has_org_role(e.organization_id, 'editor')
    )
  );

-- ── phases, pools, pool_members, bracket_slots ───────────────────────────────

-- Public read for published events; org members see all; org admins write
CREATE POLICY "phases_select" ON phases FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM tournaments t
      JOIN events e ON e.id = t.event_id
      WHERE t.id = phases.tournament_id
        AND (is_org_member(e.organization_id) OR e.status IN ('published','running','completed'))
    )
  );

CREATE POLICY "phases_write" ON phases FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM tournaments t
      JOIN events e ON e.id = t.event_id
      WHERE t.id = phases.tournament_id
        AND has_org_role(e.organization_id, 'admin')
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
        AND (is_org_member(e.organization_id) OR e.status IN ('published','running','completed'))
    )
  );

CREATE POLICY "pools_write" ON pools FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = pools.phase_id
        AND has_org_role(e.organization_id, 'admin')
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
        AND (is_org_member(e.organization_id) OR e.status IN ('published','running','completed'))
    )
  );

CREATE POLICY "pool_members_write" ON pool_members FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM pools p
      JOIN phases ph ON ph.id = p.phase_id
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE p.id = pool_members.pool_id
        AND has_org_role(e.organization_id, 'admin')
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
        AND (is_org_member(e.organization_id) OR e.status IN ('published','running','completed'))
    )
  );

CREATE POLICY "bracket_slots_write" ON bracket_slots FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = bracket_slots.phase_id
        AND has_org_role(e.organization_id, 'admin')
    )
  );

-- ── matches ───────────────────────────────────────────────────────────────────

-- Public read for published events; scorekeepers can update their assigned matches
CREATE POLICY "matches_select" ON matches FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = matches.phase_id
        AND (is_org_member(e.organization_id) OR e.status IN ('published','running','completed'))
    )
  );

CREATE POLICY "matches_write" ON matches FOR ALL
  USING (
    is_super_admin()
    OR scorekeeper_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = matches.phase_id
        AND has_org_role(e.organization_id, 'scorekeeper')
    )
  );

-- ── match_events ──────────────────────────────────────────────────────────────

CREATE POLICY "match_events_select" ON match_events FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM matches m
      JOIN phases ph ON ph.id = m.phase_id
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE m.id = match_events.match_id
        AND (is_org_member(e.organization_id) OR e.status IN ('published','running','completed'))
    )
  );

CREATE POLICY "match_events_write" ON match_events FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM matches m
      JOIN phases ph ON ph.id = m.phase_id
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE m.id = match_events.match_id
        AND (m.scorekeeper_user_id = auth.uid() OR has_org_role(e.organization_id, 'scorekeeper'))
    )
  );

-- ── exchanges ─────────────────────────────────────────────────────────────────

-- Public read for published events; scorekeepers write
CREATE POLICY "exchanges_select" ON exchanges FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM matches m
      JOIN phases ph ON ph.id = m.phase_id
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE m.id = exchanges.match_id
        AND (is_org_member(e.organization_id) OR e.status IN ('published','running','completed'))
    )
  );

CREATE POLICY "exchanges_insert" ON exchanges FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM matches m
      JOIN phases ph ON ph.id = m.phase_id
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE m.id = exchanges.match_id
        AND (m.scorekeeper_user_id = auth.uid() OR has_org_role(e.organization_id, 'scorekeeper'))
    )
  );

-- Voiding: only org admins or the scorekeeper can void
CREATE POLICY "exchanges_update" ON exchanges FOR UPDATE
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM matches m
      JOIN phases ph ON ph.id = m.phase_id
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE m.id = exchanges.match_id
        AND has_org_role(e.organization_id, 'admin')
    )
  );

-- ── workshops ─────────────────────────────────────────────────────────────────

CREATE POLICY "workshops_select" ON workshops FOR SELECT
  USING (
    is_super_admin()
    OR is_org_member(event_org_id(event_id))
    OR (
      status = 'published'
      AND EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = workshops.event_id
          AND e.status IN ('published','running','completed')
      )
    )
  );

CREATE POLICY "workshops_write" ON workshops FOR ALL
  USING (is_super_admin() OR has_org_role(event_org_id(event_id), 'editor'))
  WITH CHECK (is_super_admin() OR has_org_role(event_org_id(event_id), 'editor'));

CREATE POLICY "workshop_instructors_select" ON workshop_instructors FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_instructors.workshop_id
        AND (
          is_org_member(event_org_id(w.event_id))
          OR w.status = 'published'
        )
    )
  );

CREATE POLICY "workshop_instructors_write" ON workshop_instructors FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_instructors.workshop_id
        AND has_org_role(event_org_id(w.event_id), 'editor')
    )
  );

CREATE POLICY "workshop_sessions_select" ON workshop_sessions FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_sessions.workshop_id
        AND (
          is_org_member(event_org_id(w.event_id))
          OR w.status = 'published'
        )
    )
  );

CREATE POLICY "workshop_sessions_write" ON workshop_sessions FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_sessions.workshop_id
        AND has_org_role(event_org_id(w.event_id), 'editor')
    )
  );

-- Workshop enrollments: users can manage their own; org members can see all
CREATE POLICY "workshop_enrollments_select" ON workshop_enrollments FOR SELECT
  USING (
    is_super_admin()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workshop_sessions ws
      JOIN workshops w ON w.id = ws.workshop_id
      WHERE ws.id = workshop_enrollments.workshop_session_id
        AND is_org_member(event_org_id(w.event_id))
    )
  );

CREATE POLICY "workshop_enrollments_write" ON workshop_enrollments FOR ALL
  USING (
    is_super_admin()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workshop_sessions ws
      JOIN workshops w ON w.id = ws.workshop_id
      WHERE ws.id = workshop_enrollments.workshop_session_id
        AND has_org_role(event_org_id(w.event_id), 'editor')
    )
  );

-- ── referee tables ────────────────────────────────────────────────────────────

CREATE POLICY "referee_qualifications_select" ON referee_qualifications FOR SELECT
  USING (
    is_super_admin()
    OR user_id = auth.uid()
    OR is_org_member(event_org_id(event_id))
  );

CREATE POLICY "referee_qualifications_write" ON referee_qualifications FOR ALL
  USING (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'));

CREATE POLICY "referee_assignments_select" ON referee_assignments FOR SELECT
  USING (
    is_super_admin()
    OR user_id = auth.uid()
    OR is_org_member(event_org_id(event_id))
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = referee_assignments.event_id
        AND e.status IN ('published','running','completed')
    )
  );

CREATE POLICY "referee_assignments_write" ON referee_assignments FOR ALL
  USING (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'));

CREATE POLICY "pool_assignment_settings_select" ON pool_assignment_settings FOR SELECT
  USING (is_super_admin() OR is_org_member(event_org_id(event_id)));

CREATE POLICY "pool_assignment_settings_write" ON pool_assignment_settings FOR ALL
  USING (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'));

-- ── audit_log ─────────────────────────────────────────────────────────────────

-- Super admin sees all; org members see their org's entries
CREATE POLICY "audit_log_select" ON audit_log FOR SELECT
  USING (
    is_super_admin()
    OR actor_user_id = auth.uid()
  );

-- Only service_role (NestJS) inserts audit log entries
-- No INSERT policy for authenticated users — they go through the API

-- ── push_subscriptions ────────────────────────────────────────────────────────

CREATE POLICY "ruleset_submissions_super_admin_all" ON ruleset_submissions
  FOR ALL USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "feature_flags_super_admin_all" ON feature_flags
  FOR ALL USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "push_subscriptions_select" ON push_subscriptions FOR SELECT
  USING (is_super_admin() OR user_id = auth.uid());

CREATE POLICY "push_subscriptions_write" ON push_subscriptions FOR ALL
  USING (is_super_admin() OR user_id = auth.uid())
  WITH CHECK (is_super_admin() OR user_id = auth.uid());

-- ── notification_preferences ─────────────────────────────────────────────────

CREATE POLICY "notification_preferences_select" ON notification_preferences FOR SELECT
  USING (is_super_admin() OR user_id = auth.uid());

CREATE POLICY "notification_preferences_write" ON notification_preferences FOR ALL
  USING (is_super_admin() OR user_id = auth.uid())
  WITH CHECK (is_super_admin() OR user_id = auth.uid());

-- ============================================================
-- End of 0002_rls.sql
-- ============================================================
